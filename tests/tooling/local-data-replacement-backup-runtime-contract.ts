import assert from "node:assert/strict";

import {
  type CoreResult,
  createCapacityPolicy,
  createReplacementCoordinator,
  type ErrorAdapter,
  type LocalDataPolicy,
  type PersistentRecoveryProtocol,
  type PolicyStage,
  type ReplacementMode,
  type StoragePort,
} from "@pc-build-planner/local-data";
import { createBackupOrchestrator } from "@pc-build-planner/local-data/backup";

type RootMaintenance = Readonly<{ kind: "root-maintenance" }>;
type Root = Readonly<{
  revision: number;
  value: string;
  valid: true;
  maintenance: RootMaintenance;
}>;
type PolicyError = Readonly<{
  identity: symbol;
  payload: Readonly<{ stage: PolicyStage }>;
  context: Readonly<{ mode: ReplacementMode }>;
}>;
type OutputError = Readonly<{ kind: "mapped" | "closed"; source: PolicyError }>;
type Fence = Readonly<{ kind: "owner-fence"; token: string }>;
type Finalization = Readonly<{ kind: "owner-finalization"; token: string }>;
type Pending = Readonly<{
  kind: "owner-pending";
  fenceToken: string;
  revision: number;
  finalization: Finalization;
}>;
type Anomaly = Readonly<{
  kind: "owner-anomaly";
  healthy: boolean;
  revision?: number;
}>;
type Control = Readonly<{ kind: "owner-control"; pending?: Pending }>;

const maintenance: RootMaintenance = { kind: "root-maintenance" };
const root = (value = "current", revision = 4): Root => ({
  revision,
  value,
  valid: true,
  maintenance,
});
const clearControl = (): Control => ({ kind: "owner-control" });

const readRoot = (input: unknown): CoreResult<Root, PolicyError> => {
  if (typeof input !== "object" || input === null)
    return { ok: false, error: policyFailure("decode") };
  if (
    !("valid" in input) ||
    !("revision" in input) ||
    !("value" in input) ||
    !("maintenance" in input)
  )
    return { ok: false, error: policyFailure("decode") };
  const candidateMaintenance = input.maintenance;
  if (
    input.valid !== true ||
    typeof input.revision !== "number" ||
    typeof input.value !== "string" ||
    typeof candidateMaintenance !== "object" ||
    candidateMaintenance === null ||
    !("kind" in candidateMaintenance) ||
    candidateMaintenance.kind !== "root-maintenance"
  )
    return { ok: false, error: policyFailure("decode") };
  return {
    ok: true,
    value: {
      revision: input.revision,
      value: input.value,
      valid: true,
      maintenance,
    },
  };
};

const readControl = (input: unknown): CoreResult<Control, OutputError> => {
  if (typeof input !== "object" || input === null)
    return { ok: false, error: closedError("assessment") };
  if (!("kind" in input) || input.kind !== "owner-control")
    return { ok: false, error: closedError("assessment") };
  if (!("pending" in input) || input.pending === undefined)
    return { ok: true, value: clearControl() };
  const pending = input.pending;
  if (typeof pending !== "object" || pending === null)
    return { ok: false, error: closedError("assessment") };
  if (
    !("kind" in pending) ||
    !("fenceToken" in pending) ||
    !("revision" in pending) ||
    !("finalization" in pending)
  )
    return { ok: false, error: closedError("assessment") };
  const finalization = pending.finalization;
  if (
    pending.kind !== "owner-pending" ||
    typeof pending.fenceToken !== "string" ||
    typeof pending.revision !== "number" ||
    typeof finalization !== "object" ||
    finalization === null
  )
    return { ok: false, error: closedError("assessment") };
  if (
    !("kind" in finalization) ||
    !("token" in finalization) ||
    finalization.kind !== "owner-finalization" ||
    typeof finalization.token !== "string"
  )
    return { ok: false, error: closedError("assessment") };
  return {
    ok: true,
    value: {
      kind: "owner-control",
      pending: {
        kind: "owner-pending",
        fenceToken: pending.fenceToken,
        revision: pending.revision,
        finalization: { kind: "owner-finalization", token: finalization.token },
      },
    },
  };
};

const policyFailure = (
  stage: PolicyStage,
  mode: ReplacementMode = "normal",
): PolicyError => ({
  identity: Symbol(stage),
  payload: { stage },
  context: { mode },
});
const closedError = (stage: PolicyStage): OutputError => ({
  kind: "closed",
  source: policyFailure(stage),
});

const createHarness = (
  options: {
    corrupt?: boolean;
    failStage?: PolicyStage;
    adapterMode?: "mapped" | "closed" | "throw";
  } = {},
) => {
  let stored: unknown = options.corrupt ? { corrupt: true } : root();
  let persisted: unknown = clearControl();
  let rootWrites = 0;
  let controlWrites = 0;
  let failControlWriteAt: number | undefined;
  let decodeCalls = 0;
  const seen: Array<Readonly<{ stage: PolicyStage; error: PolicyError }>> = [];
  const expectedError = options.failStage
    ? policyFailure(options.failStage)
    : undefined;
  const storage: StoragePort<Root, Control> = {
    async readRoot() {
      return { ok: true, value: structuredClone(stored) };
    },
    async writeRoot(value) {
      rootWrites += 1;
      stored = structuredClone(value);
      return { ok: true, value: undefined };
    },
    async readControl() {
      return { ok: true, value: structuredClone(persisted) };
    },
    async writeControl(value) {
      controlWrites += 1;
      if (controlWrites === failControlWriteAt)
        return { ok: false, error: { code: "storage-unavailable" } };
      persisted = structuredClone(value);
      return { ok: true, value: undefined };
    },
    async bytesInUse() {
      return { ok: true, value: 10 };
    },
    quotaBytes: () => 1_000,
    async restrictToTrustedContexts() {
      return { ok: true, value: undefined };
    },
  };
  const policy: LocalDataPolicy<Root, never, RootMaintenance, PolicyError> = {
    decodeFailureStage: (error) =>
      error.payload.stage === "migration" ? "migration" : "decode",
    decodeAndMigrate(input) {
      decodeCalls += 1;
      const fail = options.failStage;
      const matchingCall =
        fail === "decode"
          ? decodeCalls === 1
          : fail === "migration"
            ? decodeCalls === 2
            : fail === "assessment"
              ? decodeCalls === 4
              : fail === "validation"
                ? decodeCalls === 3
                : fail === "replacement-validation"
                  ? decodeCalls === 6
                  : false;
      if (matchingCall && expectedError)
        return { ok: false, error: expectedError };
      return readRoot(input);
    },
    apply: (value) => ({ ok: true, value }),
    repair(value) {
      return options.failStage === "repair" && expectedError
        ? { ok: false, error: expectedError }
        : { ok: true, value };
    },
    revision: (value) => value.revision,
    withRevision: (value, revision) => ({ ...value, revision }),
    requestRecord: () => undefined,
    withRequestRecord: (value) => value,
    control: (value) => value.maintenance,
    withControl: (value, next) => ({ ...value, maintenance: next }),
  };
  const protocol: PersistentRecoveryProtocol<
    Control,
    OutputError,
    Fence,
    Pending,
    Anomaly,
    Finalization
  > = {
    authorizeMutation: () => ({ ok: true, value: undefined }),
    observeCurrent(raw) {
      const decoded = readRoot(raw);
      return {
        ok: true,
        value: decoded.ok
          ? {
              kind: "owner-anomaly",
              healthy: true,
              revision: decoded.value.revision,
            }
          : { kind: "owner-anomaly", healthy: false },
      };
    },
    acquire(value, mode, anomaly) {
      const control = readControl(value);
      if (!control.ok) return control;
      return anomaly.healthy === (mode === "normal")
        ? {
            ok: true,
            value: {
              control: control.value,
              fence: { kind: "owner-fence", token: `fence:${mode}` },
            },
          }
        : { ok: false, error: closedError("assessment") };
    },
    prepareCommit(value, fence, binding) {
      const control = readControl(value);
      if (!control.ok) return control;
      const finalization: Finalization = {
        kind: "owner-finalization",
        token: `final:${fence.token}:${binding.targetRevision}`,
      };
      const pending: Pending = {
        kind: "owner-pending",
        fenceToken: fence.token,
        revision: binding.targetRevision,
        finalization,
      };
      return {
        ok: true,
        value: {
          control: { kind: "owner-control", pending },
          pending,
          finalization,
        },
      };
    },
    classifyCurrent(value, anomaly) {
      const control = readControl(value);
      if (!control.ok) return control;
      const pending = control.value.pending;
      if (!pending) return { ok: true, value: { kind: "clear" } };
      return anomaly.revision === pending.revision
        ? {
            ok: true,
            value: {
              kind: "postcommit-finalization",
              pending,
              ticket: pending.finalization,
            },
          }
        : { ok: true, value: { kind: "precommit-pending", pending } };
    },
    release(value) {
      const control = readControl(value);
      return control.ok ? { ok: true, value: clearControl() } : control;
    },
    finalize(value, ticket, anomaly) {
      const control = readControl(value);
      if (!control.ok) return control;
      return control.value.pending?.finalization.token === ticket.token &&
        control.value.pending.revision === anomaly.revision
        ? { ok: true, value: clearControl() }
        : { ok: false, error: closedError("assessment") };
    },
  };
  const errors: ErrorAdapter<PolicyError, OutputError> = {
    fromPolicy(stage, error) {
      seen.push({ stage, error });
      if (options.adapterMode === "throw") throw new Error(`adapter:${stage}`);
      const output = {
        kind: options.adapterMode === "closed" ? "closed" : "mapped",
        source: error,
      } as const;
      return options.adapterMode === "closed"
        ? { ok: false, error: output }
        : { ok: true, value: output };
    },
    fromCore: () => ({ ok: false, error: closedError("assessment") }),
  };
  const dependencies = {
    storage,
    lock: {
      async runExclusive<T>(operation: () => Promise<T>) {
        return { ok: true as const, value: await operation() };
      },
    },
    policy,
    recovery: protocol,
    errors,
    capacity: createCapacityPolicy<Root>((value) => value.value.length),
    candidateDigest: (value: Root) => value.value,
    rawFingerprint: (value: unknown) => JSON.stringify(value),
    newCapabilityId: () => "unused",
    preview: (value: Root, _capacity: unknown, mode: ReplacementMode) => ({
      value: value.value,
      mode,
    }),
  };
  const replacement = () => createReplacementCoordinator(dependencies);
  return {
    replacement,
    seen,
    expectedError,
    writes: () => rootWrites,
    setPersisted: (value: Control) => {
      persisted = structuredClone(value);
    },
    persisted: () => {
      const decoded = readControl(structuredClone(persisted));
      if (!decoded.ok) throw new Error("invalid persisted fixture control");
      return decoded.value;
    },
    failControlWriteAt: (value: number | undefined) => {
      failControlWriteAt = value;
    },
  };
};

const commitOnce = async (mode: ReplacementMode) => {
  const state = createHarness({ corrupt: mode === "recovery" });
  const replacement = state.replacement();
  const candidate = root("replacement");
  const assessed =
    mode === "normal"
      ? await replacement.assess(candidate)
      : await replacement.assessRecovery(candidate);
  assert.equal(assessed.ok, true);
  if (!assessed.ok) return;
  const committed = await replacement.commit({
    candidate,
    mode,
    ticket: assessed.value.ticket,
  });
  assert.equal(committed.ok && committed.value.kind, "committed");
  assert.equal(state.writes(), 1);
  const stale = await replacement.commit({
    candidate,
    mode,
    ticket: assessed.value.ticket,
  });
  assert.equal(stale.ok, false);
  assert.equal(state.writes(), 1);
};
await commitOnce("normal");
await commitOnce("recovery");

for (const stage of [
  "decode",
  "migration",
  "repair",
  "validation",
  "assessment",
  "replacement-validation",
] as const) {
  for (const adapterMode of ["mapped", "closed", "throw"] as const) {
    const state = createHarness({ failStage: stage, adapterMode });
    const replacement = state.replacement();
    const candidate = root("candidate");
    const operation = async () => {
      const assessed = await replacement.assess(candidate);
      if (!assessed.ok) return assessed;
      return replacement.commit({
        candidate,
        mode: "normal",
        ticket: assessed.value.ticket,
      });
    };
    if (adapterMode === "throw")
      await assert.rejects(operation, new RegExp(`adapter:${stage}`));
    else {
      const result = await operation();
      assert.equal(result.ok, false);
      if (!result.ok && state.expectedError)
        assert.strictEqual(result.error.source, state.expectedError);
    }
    assert.equal(state.seen.length, 1);
    assert.equal(state.seen[0]?.stage, stage);
    assert.strictEqual(state.seen[0]?.error, state.expectedError);
    assert.deepEqual(state.expectedError?.payload, { stage });
    assert.deepEqual(state.expectedError?.context, { mode: "normal" });
    assert.equal(state.writes(), 0);
  }
}

const cleanup = createHarness();
const cleanupReplacement = cleanup.replacement();
const cleanupCandidate = root("cleanup");
const cleanupAssessment = await cleanupReplacement.assess(cleanupCandidate);
assert.equal(cleanupAssessment.ok, true);
if (!cleanupAssessment.ok) throw new Error("cleanup assessment failed");
cleanup.setPersisted({
  kind: "owner-control",
  pending: {
    kind: "owner-pending",
    fenceToken: "old",
    revision: 99,
    finalization: { kind: "owner-finalization", token: "old-final" },
  },
});
cleanup.failControlWriteAt(1);
const cleanupFailure = await cleanupReplacement.commit({
  candidate: cleanupCandidate,
  mode: "normal",
  ticket: cleanupAssessment.value.ticket,
});
assert.equal(cleanupFailure.ok, false);
assert.equal(cleanup.writes(), 0);
cleanup.failControlWriteAt(undefined);
const cleanupRetry = await cleanupReplacement.commit({
  candidate: cleanupCandidate,
  mode: "normal",
  ticket: cleanupAssessment.value.ticket,
});
assert.equal(cleanupRetry.ok && cleanupRetry.value.kind, "committed");
assert.equal(cleanup.writes(), 1);

const lifecycle = createHarness();
const firstReplacement = lifecycle.replacement();
const backup = (replacement: ReturnType<typeof lifecycle.replacement>) =>
  createBackupOrchestrator({
    snapshot: {
      async read() {
        return { ok: true, value: root() };
      },
    },
    codec: {
      create: (value: Root) => ({ ok: true, value: value.value }),
      decode: (value: string) => ({ ok: true, value }),
      version: (value: string) => ({ ok: true, value }),
      map: (value: string) => ({ ok: true, value }),
      toRoot: (value: string) => ({ ok: true, value: root(value) }),
      preview: (value: string) => value,
    },
    artifactPolicy: { create: (value: string) => ({ ok: true, value }) },
    replacementMode: () => "normal",
    replacement,
  });
const firstBackup = backup(firstReplacement);
const preflight = await firstBackup.preflight("backup");
assert.equal(preflight.ok, true);
if (!preflight.ok) throw new Error("preflight failed");
lifecycle.failControlWriteAt(2);
const committed = await firstBackup.commit(preflight.value.ticket);
assert.equal(
  committed.ok && committed.value.kind,
  "committed-finalization-required",
);
assert.equal(lifecycle.writes(), 1);
if (!committed.ok || committed.value.kind !== "committed-finalization-required")
  throw new Error("missing finalization");
lifecycle.failControlWriteAt(undefined);
const clonedControl = structuredClone(lifecycle.persisted());
lifecycle.setPersisted(clonedControl);
const recreatedBackup = backup(lifecycle.replacement());
const found = await recreatedBackup.findPendingFinalization();
assert.equal(found.ok, true);
assert.deepEqual(found.ok && found.value, committed.value.finalization);
assert.notStrictEqual(found.ok && found.value, committed.value.finalization);
const writesBeforeFinalize = lifecycle.writes();
if (!found.ok || found.value === null)
  throw new Error("pending finalization not found");
const finalized = await recreatedBackup.finalize(structuredClone(found.value));
assert.equal(finalized.ok, true);
assert.equal(lifecycle.writes(), writesBeforeFinalize);

const reassessState = createHarness();
const reassessBackup = backup(reassessState.replacement());
const oldPreflight = await reassessBackup.preflight("old");
assert.equal(oldPreflight.ok, true);
if (!oldPreflight.ok) throw new Error("preflight failed");
const reassessed = await reassessBackup.reassess(oldPreflight.value.ticket);
assert.equal(reassessed.ok, true);
if (!reassessed.ok) throw new Error("reassessment failed");
assert.notStrictEqual(reassessed.value.ticket, oldPreflight.value.ticket);
