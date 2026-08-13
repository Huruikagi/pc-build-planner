import assert from "node:assert/strict";
import test from "node:test";

import {
  createCapacityPolicy,
  createFencingPolicy,
  createTransactionEngine,
  createReplacementCoordinator,
  type CoreError,
  type CoreResult,
  type ErrorAdapter,
  type CapacityStatus,
  type FenceControlState,
  type LocalDataPolicy,
  type StoragePort,
  type ExclusiveLockPort,
  type ReplacementMode,
  type PersistentRecoveryProtocol,
} from "../src/index.js";

interface Root {
  readonly revision: number;
  readonly value: string;
  readonly valid: boolean;
  readonly control: FenceControlState;
}

class SyntheticAnomaly {
  constructor(readonly healthy: boolean) {}
}
class SyntheticFence {
  constructor(readonly mode: ReplacementMode, readonly nonce: number) {}
}
class SyntheticPending {
  constructor(readonly fence: SyntheticFence) {}
}
class SyntheticControl {
  constructor(readonly phase: "clear" | "pending" = "clear", readonly pending?: SyntheticPending) {}
}

interface ProtocolOutputError {
  readonly category: "protocol";
  readonly payload: { readonly step: "observe" | "acquire" | "classify" | "prepare" | "release" };
}

const root = (value = "current"): Root => ({
  revision: 4,
  value,
  valid: true,
  control: {
    active: true,
    kind: "maintenance",
    owner: "owner-a",
    generation: 2,
    leaseExpiresAt: 2_000,
    revision: 4,
  },
});

const createHarness = (
  storedRoot: unknown = root(),
  capabilityId?: () => string,
  errors: ErrorAdapter<CoreError, CoreError> = {
    fromPolicy: (_stage: import("../src/index.js").PolicyStage, error: CoreError) => ({ ok: true as const, value: error }),
    fromCore: (error: CoreError) => ({ ok: true as const, value: error }),
  },
  repairError?: CoreError,
  decodeFailure?: { at: number; error: CoreError },
) => {
  let stored = structuredClone(storedRoot);
  let control = new SyntheticControl();
  let rootWrites = 0;
  let controlWrites = 0;
  let failControlWriteAt: number | undefined;
  let failRootWriteAt: number | undefined;
  let capability = 0;
  let decodeCalls = 0;
  let rejectPreparedFence = false;
  let rejectRelease = false;
  const stages: string[] = [];
  const storage: StoragePort<Root, SyntheticControl> = {
    async readRoot() { return { ok: true, value: structuredClone(stored) }; },
    async writeRoot(value) { rootWrites += 1; if (rootWrites === failRootWriteAt) return { ok: false, error: { code: "storage-unavailable" } }; stored = value; return { ok: true, value: undefined }; },
    async readControl() { return { ok: true, value: control }; },
    async writeControl(value) { controlWrites += 1; if (controlWrites === failControlWriteAt) return { ok: false, error: { code: "storage-unavailable" } }; control = value; return { ok: true, value: undefined }; },
    async bytesInUse() { return { ok: true, value: 100 }; },
    quotaBytes: () => 1_000,
    async restrictToTrustedContexts() { return { ok: true, value: undefined }; },
  };
  const recovery: PersistentRecoveryProtocol<SyntheticControl, CoreError, SyntheticFence, SyntheticPending, SyntheticAnomaly> = {
    authorizeMutation(value) {
      return value instanceof SyntheticControl && value.phase === "clear"
        ? { ok: true, value: undefined }
        : { ok: false, error: { code: "recovery-active" } };
    },
    observeCurrent(raw) {
      return { ok: true, value: new SyntheticAnomaly(typeof raw === "object" && raw !== null && "valid" in raw && raw.valid === true) };
    },
    acquire(value, mode, current) {
      if (!(value instanceof SyntheticControl) || value.phase !== "clear" || current.healthy !== (mode === "normal"))
        return { ok: false, error: { code: mode === "normal" ? "stale-fence" : "stale-recovery-state" } };
      return { ok: true, value: { control: value, fence: new SyntheticFence(mode, ++capability) } };
    },
    prepareCommit(value, fence, binding) {
      if (rejectPreparedFence || !(value instanceof SyntheticControl) || value.phase !== "clear" || fence.mode !== binding.mode)
        return { ok: false, error: { code: "stale-assessment" } };
      const pending = new SyntheticPending(fence);
      return { ok: true, value: { control: new SyntheticControl("pending", pending), pending } };
    },
    classifyCurrent(value) {
      if (!(value instanceof SyntheticControl)) return { ok: false, error: { code: "stale-recovery-state" } };
      return value.phase === "clear" ? { ok: true, value: { kind: "clear" } } : { ok: true, value: { kind: "precommit-pending", pending: value.pending! } };
    },
    release(value, capability) {
      if (rejectRelease) return { ok: false, error: { code: "stale-assessment" } };
      if (!(value instanceof SyntheticControl) || (value.phase === "pending" && value.pending !== capability))
        return { ok: false, error: { code: "stale-assessment" } };
      return { ok: true, value: new SyntheticControl() };
    },
    finalize() { return { ok: false, error: { code: "stale-assessment" } }; },
  };
  const lock: ExclusiveLockPort = { async runExclusive(operation) { return { ok: true, value: await operation() }; } };
  const policy: LocalDataPolicy<Root, { readonly value: string }, FenceControlState, CoreError> = {
    decodeFailureStage: (error) => error.code === "migration" ? "migration" : "decode",
    decodeAndMigrate(input) {
      decodeCalls += 1;
      stages.push("decode");
      if (decodeFailure?.at === decodeCalls) return { ok: false, error: decodeFailure.error };
      if (typeof input !== "object" || input === null || !("valid" in input))
        return { ok: false, error: { code: "migration" } };
      const value = input as Root;
      return value.valid
        ? { ok: true, value }
        : { ok: false, error: { code: "validation" } };
    },
    apply: (candidate, operation) => ({ ok: true, value: { ...candidate, value: operation.value } }),
    repair(candidate) { stages.push("repair"); return repairError ? { ok: false, error: repairError } : { ok: true, value: { ...candidate, value: candidate.value.trim() } }; },
    revision: (candidate) => candidate.revision,
    withRevision: (candidate, revision) => ({ ...candidate, revision }),
    requestRecord: () => undefined,
    withRequestRecord: (candidate) => candidate,
    control: (candidate) => candidate.control,
    withControl: (candidate, next) => ({ ...candidate, control: next }),
  };
  const dependencies = {
    storage,
    lock,
    policy,
    capacity: createCapacityPolicy<Root>((candidate) => candidate.value.length),
    candidateDigest: (candidate: Root) => `digest:${candidate.value}`,
    rawFingerprint: (raw: unknown) => `raw:${JSON.stringify(raw)}`,
    newCapabilityId: capabilityId ?? (() => `capability-${++capability}`),
    preview: (candidate: Root, capacity: CapacityStatus, mode: ReplacementMode) => ({ value: candidate.value, bytes: capacity.afterBytes, mode }),
    errors,
    recovery,
  };
  const coordinator = createReplacementCoordinator(dependencies);
  const transaction = createTransactionEngine({
    storage,
    lock,
    policy,
    capacity: dependencies.capacity,
    digest: (operation: { readonly value: string }) => `operation:${operation.value}`,
    now: () => 1_000,
    fencing: createFencingPolicy<Root>({
      revision: (value) => value.revision,
      read: (value) => value.control,
      write: (value, next) => ({ ...value, control: next }),
    }),
    recovery: {
      authorizeMutation(value: unknown): CoreResult<void, CoreError> {
        if (typeof value !== "object" || value === null) return { ok: false as const, error: { code: "stale-fence" as const } };
        const current = value as Record<string, unknown>;
        if (current.active === false) return { ok: true as const, value: undefined };
        if (current.active === true && current.kind === "maintenance") return { ok: false as const, error: { code: "maintenance-active" as const } };
        if (current.active === true && current.kind === "recovery") return { ok: false as const, error: { code: "recovery-active" as const } };
        return { ok: false as const, error: { code: "stale-fence" as const } };
      },
    },
    errors: {
      fromPolicy: (_stage, error) => ({ ok: true, value: error }),
      fromCore: (error) => ({ ok: true, value: error }),
    },
  });
  return {
    coordinator,
    recreateCoordinator: () => createReplacementCoordinator(dependencies),
    mutate: (expectedRevision: number) => transaction.execute({ requestId: `mutation-${expectedRevision}`, expectedRevision, operation: { value: "mutated" } }),
    stages,
    writes: () => ({ root: rootWrites, control: controlWrites }),
    stored: () => structuredClone(stored) as Root,
    persistentControl: () => control,
    setStored(value: unknown) { stored = structuredClone(value); },
    setControl(value: SyntheticControl) { control = value; },
    decodeCalls: () => decodeCalls,
    failControlWriteAt(value: number) { failControlWriteAt = value; },
    allowControlWrites() { failControlWriteAt = undefined; },
    failRootWriteAt(value: number) { failRootWriteAt = value; },
    invalidateProtocolCapability() { rejectPreparedFence = true; },
    failRelease() { rejectRelease = true; },
    allowRelease() { rejectRelease = false; },
  };
};

test("normal assessment repairs, validates, and measures without writes or exposed bindings", async () => {
  const harness = createHarness();
  const result = await harness.coordinator.assess({ ...root(" candidate "), revision: 99 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.preview, { value: "candidate", bytes: 9, mode: "normal" });
  assert.deepEqual(Object.keys(result.value.ticket), []);
  assert.equal(JSON.stringify(result.value.ticket), "{}");
  assert.deepEqual(harness.stages, ["decode", "decode", "repair", "decode"]);
  assert.deepEqual(harness.writes(), { root: 0, control: 0 });
});

test("replacement policy errors preserve identity and context and adapter failures never write", async () => {
  const policyError = { code: "repair", payload: { candidate: "synthetic" }, context: { mode: "normal" } } as const;
  const seen: Array<{ stage: string; error: CoreError }> = [];
  const failClosed = createHarness(root(), undefined, {
    fromPolicy(stage, error) { seen.push({ stage, error }); return { ok: false as const, error: { code: "request-conflict" as const } }; },
    fromCore: (error) => ({ ok: true as const, value: error }),
  }, policyError);
  assert.deepEqual(await failClosed.coordinator.assess(root("candidate")), { ok: false, error: { code: "request-conflict" } });
  assert.equal(seen[0]?.stage, "repair");
  assert.strictEqual(seen[0]?.error, policyError);
  assert.equal(failClosed.writes().root, 0);

  const throwing = createHarness(root(), undefined, {
    fromPolicy() { throw new Error("consumer mapping rejected"); },
    fromCore: (error) => ({ ok: true as const, value: error }),
  }, policyError);
  await assert.rejects(() => throwing.coordinator.assess(root("candidate")));
  assert.equal(throwing.writes().root, 0);
});

test("replacement decode, migration, and validation stages preserve the exact policy error", async () => {
  for (const [at, expectedStage] of [[1, "decode"], [2, "migration"], [3, "validation"]] as const) {
    for (const adapterMode of ["mapped", "fail-closed", "throw"] as const) {
      const policyError = { code: expectedStage === "migration" ? "migration" as const : "validation" as const, payload: { at }, context: { expectedStage, adapterMode } };
      const seen: Array<{ stage: string; error: CoreError }> = [];
      const harness = createHarness(root(), undefined, {
        fromPolicy(stage, error) {
          seen.push({ stage, error });
          if (adapterMode === "throw") throw new Error(`adapter:${expectedStage}`);
          return adapterMode === "mapped"
            ? { ok: true, value: { code: "revision-conflict" } }
            : { ok: false, error: { code: "request-conflict" } };
        },
        fromCore: (error) => ({ ok: true, value: error }),
      }, undefined, { at, error: policyError });
      const assess = () => harness.coordinator.assess(root("candidate"));
      if (adapterMode === "throw") await assert.rejects(assess, new RegExp(`adapter:${expectedStage}`));
      else assert.deepEqual(await assess(), { ok: false, error: { code: adapterMode === "mapped" ? "revision-conflict" : "request-conflict" } });
      assert.equal(seen[0]?.stage, expectedStage);
      assert.strictEqual(seen[0]?.error, policyError);
      assert.equal(harness.writes().root, 0);
    }
  }
});

test("replacement assessment candidate classifies decode and migration policy failures", async () => {
  for (const expectedStage of ["decode", "migration"] as const) {
    for (const adapterMode of ["mapped", "fail-closed", "throw"] as const) {
      const policyError = {
        code: expectedStage === "migration" ? "migration" as const : "validation" as const,
        payload: { candidate: "assessment" },
        context: { expectedStage, adapterMode },
      };
      const seen: Array<{ stage: string; error: CoreError }> = [];
      const harness = createHarness(root(), undefined, {
        fromPolicy(stage, error) {
          seen.push({ stage, error });
          if (adapterMode === "throw") throw new Error(`assessment-candidate:${expectedStage}`);
          return adapterMode === "mapped"
            ? { ok: true, value: { code: "revision-conflict" } }
            : { ok: false, error: { code: "request-conflict" } };
        },
        fromCore: (error) => ({ ok: true, value: error }),
      }, undefined, { at: 2, error: policyError });

      const assess = () => harness.coordinator.assess(root("candidate"));
      if (adapterMode === "throw") await assert.rejects(assess, new RegExp(`assessment-candidate:${expectedStage}`));
      else assert.deepEqual(await assess(), { ok: false, error: { code: adapterMode === "mapped" ? "revision-conflict" : "request-conflict" } });
      assert.equal(seen[0]?.stage, expectedStage);
      assert.strictEqual(seen[0]?.error, policyError);
      assert.deepEqual(seen[0]?.error, policyError);
      assert.equal(harness.writes().root, 0);
    }
  }
});

test("replacement commit candidate classifies decode and migration policy failures", async () => {
  for (const expectedStage of ["decode", "migration"] as const) {
    for (const adapterMode of ["mapped", "fail-closed", "throw"] as const) {
      const policyError = {
        code: expectedStage === "migration" ? "migration" as const : "validation" as const,
        payload: { candidate: "commit" },
        context: { expectedStage, adapterMode },
      };
      const seen: Array<{ stage: string; error: CoreError }> = [];
      const harness = createHarness(root(), undefined, {
        fromPolicy(stage, error) {
          seen.push({ stage, error });
          if (adapterMode === "throw") throw new Error(`commit-candidate:${expectedStage}`);
          return adapterMode === "mapped"
            ? { ok: true, value: { code: "revision-conflict" } }
            : { ok: false, error: { code: "request-conflict" } };
        },
        fromCore: (error) => ({ ok: true, value: error }),
      }, undefined, { at: 5, error: policyError });

      const assessed = await harness.coordinator.assess(root("candidate"));
      assert.equal(assessed.ok, true);
      if (!assessed.ok) continue;
      const commit = () => harness.coordinator.commit({ candidate: root("candidate"), mode: "normal", ticket: assessed.value.ticket });
      if (adapterMode === "throw") await assert.rejects(commit, new RegExp(`commit-candidate:${expectedStage}`));
      else assert.deepEqual(await commit(), { ok: false, error: { code: adapterMode === "mapped" ? "revision-conflict" : "request-conflict" } });
      assert.equal(seen[0]?.stage, expectedStage);
      assert.strictEqual(seen[0]?.error, policyError);
      assert.deepEqual(seen[0]?.error, policyError);
      assert.equal(harness.writes().root, 0);
    }
  }
});

test("replacement commit preserves policy failures", async () => {
  const policyError = { code: "validation", payload: { token: "same-payload" }, context: { decision: "synthetic" } } as const;
  const output = { code: "request-conflict" as const };
  const seen: Array<{ stage: string; error: CoreError }> = [];
  const errors: ErrorAdapter<CoreError, CoreError> = {
    fromPolicy(stage, error) { seen.push({ stage, error }); return { ok: true, value: output }; },
    fromCore: (error) => ({ ok: true, value: error }),
  };

  const commitFailure = { at: 4, error: policyError };
  const commitHarness = createHarness(root(), undefined, errors, undefined, commitFailure);
  const assessed = await commitHarness.coordinator.assess(root("candidate"));
  assert.equal(assessed.ok, true);
  if (assessed.ok) {
    assert.deepEqual(await commitHarness.coordinator.commit({ candidate: root("candidate"), mode: "normal", ticket: assessed.value.ticket }), { ok: false, error: output });
  }
  assert.equal(commitHarness.writes().root, 0);
  assert.equal(seen.at(-1)?.stage, "assessment");
  assert.strictEqual(seen.at(-1)?.error, policyError);

});

test("replacement adapter throws escape commit without a root write", async () => {
  const policyError = { code: "validation", payload: { token: "throw" }, context: { decision: "reject" } } as const;
  const throwing: ErrorAdapter<CoreError, CoreError> = {
    fromPolicy() { throw new Error("adapter throw"); },
    fromCore: (error) => ({ ok: true, value: error }),
  };
  const commitHarness = createHarness(root(), undefined, throwing, undefined, { at: 4, error: policyError });
  const assessed = await commitHarness.coordinator.assess(root("candidate"));
  assert.equal(assessed.ok, true);
  if (assessed.ok) {
    await assert.rejects(() => commitHarness.coordinator.commit({ candidate: root("candidate"), mode: "normal", ticket: assessed.value.ticket }), /adapter throw/);
  }
  assert.equal(commitHarness.writes().root, 0);

});

test("replacement assessment and replacement-validation fail-closed adapters preserve output without root writes", async () => {
  for (const [at, expectedStage] of [[4, "assessment"], [6, "replacement-validation"]] as const) {
    const policyError = { code: "validation", payload: { at }, context: { expectedStage } } as const;
    const seen: Array<{ stage: string; error: CoreError }> = [];
    const harness = createHarness(root(), undefined, {
      fromPolicy(stage, error) { seen.push({ stage, error }); return { ok: false, error: { code: "request-conflict" } }; },
      fromCore: (error) => ({ ok: true, value: error }),
    }, undefined, { at, error: policyError });
    const assessed = await harness.coordinator.assess(root("candidate"));
    assert.equal(assessed.ok, true);
    if (!assessed.ok) continue;
    assert.deepEqual(await harness.coordinator.commit({ candidate: root("candidate"), mode: "normal", ticket: assessed.value.ticket }), { ok: false, error: { code: "request-conflict" } });
    assert.equal(seen[0]?.stage, expectedStage);
    assert.strictEqual(seen[0]?.error, policyError);
    assert.equal(harness.writes().root, 0);
  }
});

test("recovery assesses only an explicit candidate while the current root is corrupt", async () => {
  const harness = createHarness({ corrupt: true });
  const result = await harness.coordinator.assessRecovery(root("recovered"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.preview.mode, "recovery");
  assert.deepEqual(Object.keys(result.value.ticket), []);
  assert.deepEqual(harness.writes(), { root: 0, control: 0 });
});

test("normal and recovery reject the wrong current-root mode without writes", async () => {
  const normalOnCorrupt = createHarness({ corrupt: true });
  assert.equal((await normalOnCorrupt.coordinator.assess(root())).ok, false);
  assert.deepEqual(normalOnCorrupt.writes(), { root: 0, control: 0 });

  const recoveryOnHealthy = createHarness();
  assert.deepEqual(await recoveryOnHealthy.coordinator.assessRecovery(root()), {
    ok: false,
    error: { code: "stale-recovery-state" },
  });
  assert.deepEqual(recoveryOnHealthy.writes(), { root: 0, control: 0 });
});

test("candidate or persisted revision changes produce a distinct opaque assessment capability", async () => {
  const harness = createHarness();
  const first = await harness.coordinator.assess(root("candidate"));
  const changedCandidate = await harness.coordinator.assess(root("changed"));
  const current = root();
  harness.setStored({ ...current, revision: 5, control: { ...current.control, revision: 5 } });
  const changedRevision = await harness.coordinator.assess(root("candidate"));
  assert.equal(first.ok && changedCandidate.ok && changedRevision.ok, true);
  if (!first.ok || !changedCandidate.ok || !changedRevision.ok) return;
  assert.notEqual(first.value.ticket, changedCandidate.value.ticket);
  assert.notEqual(first.value.ticket, changedRevision.value.ticket);
  assert.deepEqual(Object.keys(first.value.ticket), []);
  assert.deepEqual(harness.writes(), { root: 0, control: 0 });
});

test("normal commit rechecks the private binding and writes the root at most once", async () => {
  const harness = createHarness();
  const candidate = root("candidate");
  const assessed = await harness.coordinator.assess(candidate);
  assert.equal(assessed.ok, true);
  if (!assessed.ok) return;
  const committed = await harness.coordinator.commit({ candidate, mode: "normal", ticket: assessed.value.ticket });
  assert.equal(committed.ok, true);
  assert.equal(committed.ok && committed.value.kind, "committed");
  assert.equal(harness.writes().root, 1);
  assert.deepEqual(await harness.coordinator.commit({ candidate, mode: "normal", ticket: assessed.value.ticket }), {
    ok: false,
    error: { code: "stale-assessment" },
  });
  assert.equal(harness.writes().root, 1);
  assert.ok(harness.persistentControl() instanceof SyntheticControl);
});

test("candidate or persisted fingerprint drift is stale before root write", async () => {
  for (const drift of [
    (h: ReturnType<typeof createHarness>) => h.setStored(root("changed-root")),
  ]) {
    const harness = createHarness();
    const assessed = await harness.coordinator.assess(root("candidate"));
    assert.equal(assessed.ok, true);
    if (!assessed.ok) continue;
    drift(harness);
    assert.deepEqual(await harness.coordinator.commit({ candidate: root("candidate"), mode: "normal", ticket: assessed.value.ticket }), {
      ok: false,
      error: { code: "stale-assessment" },
    });
    assert.equal(harness.writes().root, 0);
  }
});
test("recovery assessment and commit use opaque protocol capabilities and one root write", async () => {
  const harness = createHarness({ corrupt: true });
  const candidate = root("recovered");
  const assessed = await harness.coordinator.assessRecovery(candidate);
  assert.equal(assessed.ok, true);
  if (!assessed.ok) return;
  const outcome = await harness.coordinator.commit({ candidate, mode: "recovery", ticket: assessed.value.ticket });
  assert.equal(outcome.ok && outcome.value.kind, "committed");
  assert.equal(harness.writes().root, 1);
});

test("stale protocol capability preserves the existing root", async () => {
  const harness = createHarness();
  const candidate = root("candidate");
  const assessed = await harness.coordinator.assess(candidate);
  assert.equal(assessed.ok, true);
  if (!assessed.ok) return;
  harness.invalidateProtocolCapability();
  assert.deepEqual(await harness.coordinator.commit({ candidate, mode: "normal", ticket: assessed.value.ticket }), {
    ok: false,
    error: { code: "stale-assessment" },
  });
  assert.equal(harness.stored().value, "current");
  assert.equal(harness.writes().root, 0);
});

test("normal and recovery commits preserve the exact acquired opaque control and fence identities", async () => {
  for (const mode of ["normal", "recovery"] as const) {
    class FieldlessControl {}
    class FieldlessFence {}
    class FieldlessAnomaly {}
    class FieldlessPending {}
    const persistedControl = new FieldlessControl();
    const acquiredControl = new FieldlessControl();
    const acquiredFence = new FieldlessFence();
    let stored: unknown = mode === "normal" ? root() : { corrupt: true };
    let rootWrites = 0;
    const storage: StoragePort<Root, FieldlessControl> = {
      async readRoot() { return { ok: true, value: stored }; },
      async writeRoot(value) { rootWrites += 1; stored = value; return { ok: true, value: undefined }; },
      async readControl() { return { ok: true, value: persistedControl }; },
      async writeControl() { return { ok: true, value: undefined }; },
      async bytesInUse() { return { ok: true, value: 100 }; },
      quotaBytes: () => 1_000,
      async restrictToTrustedContexts() { return { ok: true, value: undefined }; },
    };
    const recovery: PersistentRecoveryProtocol<FieldlessControl, CoreError, FieldlessFence, FieldlessPending, FieldlessAnomaly> = {
      authorizeMutation: () => ({ ok: true, value: undefined }),
      observeCurrent: () => ({ ok: true, value: new FieldlessAnomaly() }),
      acquire: () => ({ ok: true, value: { control: acquiredControl, fence: acquiredFence } }),
      classifyCurrent: (control) => control === persistedControl ? { ok: true, value: { kind: "clear" } } : { ok: false, error: { code: "stale-assessment" } },
      prepareCommit: (control, fence) => control === acquiredControl && fence === acquiredFence
        ? { ok: true, value: { control: acquiredControl, pending: new FieldlessPending() } }
        : { ok: false, error: { code: "stale-assessment" } },
      release: () => ({ ok: true, value: persistedControl }),
      finalize: () => ({ ok: false, error: { code: "stale-assessment" } }),
    };
    const policy: LocalDataPolicy<Root, never, FenceControlState, CoreError> = {
      decodeAndMigrate: (input) => typeof input === "object" && input !== null && "valid" in input
        ? { ok: true, value: input as Root }
        : { ok: false, error: { code: "validation" } },
      apply: (value) => ({ ok: true, value }),
      repair: (value) => ({ ok: true, value }),
      revision: (value) => value.revision,
      withRevision: (value, revision) => ({ ...value, revision }),
      requestRecord: () => undefined,
      withRequestRecord: (value) => value,
      control: (value) => value.control,
      withControl: (value, control) => ({ ...value, control }),
    };
    const coordinator = createReplacementCoordinator({
      storage,
      lock: { async runExclusive(operation) { return { ok: true, value: await operation() }; } },
      policy,
      recovery,
      errors: {
        fromPolicy: (_stage, error) => ({ ok: true, value: error }),
        fromCore: (error) => ({ ok: true, value: error }),
      },
      capacity: createCapacityPolicy<Root>((value) => value.value.length),
      candidateDigest: (value) => value.value,
      rawFingerprint: (value) => JSON.stringify(value),
      newCapabilityId: () => "unused",
      preview: (value) => value.value,
    });
    const candidate = root(mode === "normal" ? "candidate" : "recovered");
    const assessed = mode === "normal" ? await coordinator.assess(candidate) : await coordinator.assessRecovery(candidate);
    assert.equal(assessed.ok, true, mode);
    if (!assessed.ok) continue;
    const committed = await coordinator.commit({ candidate, mode, ticket: assessed.value.ticket });
    assert.equal(committed.ok && committed.value.kind, "committed", mode);
    assert.equal(rootWrites, 1, mode);
  }
});

test("owner protocol failures preserve non-core output identity before root write", async () => {
  for (const step of ["observe", "acquire", "classify", "prepare"] as const) {
    const protocolError: ProtocolOutputError = { category: "protocol", payload: { step } };
    let stored = root();
    let rootWrites = 0;
    type TestOutputError = ProtocolOutputError | CoreError;
    const protocol: PersistentRecoveryProtocol<SyntheticControl, TestOutputError, SyntheticFence, SyntheticPending, SyntheticAnomaly> = {
      authorizeMutation: () => ({ ok: true, value: undefined }),
      observeCurrent: () => step === "observe" ? { ok: false, error: protocolError } : { ok: true, value: new SyntheticAnomaly(true) },
      acquire: () => step === "acquire" ? { ok: false, error: protocolError } : { ok: true, value: { control: new SyntheticControl(), fence: new SyntheticFence("normal", 1) } },
      classifyCurrent: () => step === "classify" ? { ok: false, error: protocolError } : { ok: true, value: { kind: "clear" } },
      prepareCommit: (_control, fence) => step === "prepare" ? { ok: false, error: protocolError } : { ok: true, value: { control: new SyntheticControl("pending"), pending: new SyntheticPending(fence) } },
      release: () => ({ ok: true, value: new SyntheticControl() }),
      finalize: () => ({ ok: false, error: protocolError }),
    };
    const storage: StoragePort<Root, SyntheticControl> = {
      async readRoot() { return { ok: true, value: stored }; },
      async writeRoot(value) { rootWrites += 1; stored = value; return { ok: true, value: undefined }; },
      async readControl() { return { ok: true, value: new SyntheticControl() }; },
      async writeControl() { return { ok: true, value: undefined }; },
      async bytesInUse() { return { ok: true, value: 100 }; },
      quotaBytes: () => 1_000,
      async restrictToTrustedContexts() { return { ok: true, value: undefined }; },
    };
    const policy: LocalDataPolicy<Root, never, FenceControlState, CoreError> = {
      decodeAndMigrate: (input) => typeof input === "object" && input !== null && "valid" in input ? { ok: true, value: input as Root } : { ok: false, error: { code: "validation" } },
      apply: (value) => ({ ok: true, value }), repair: (value) => ({ ok: true, value }), revision: (value) => value.revision,
      withRevision: (value, revision) => ({ ...value, revision }), requestRecord: () => undefined, withRequestRecord: (value) => value,
      control: (value) => value.control, withControl: (value, control) => ({ ...value, control }),
    };
    const coordinator = createReplacementCoordinator({
      storage, lock: { async runExclusive(operation) { return { ok: true, value: await operation() }; } }, policy, recovery: protocol,
      errors: {
        fromPolicy: (_stage, error) => ({ ok: true, value: error }),
        fromCore: () => ({ ok: true, value: { category: "protocol", payload: { step: "release" } } }),
      } satisfies ErrorAdapter<CoreError, TestOutputError>,
      capacity: createCapacityPolicy<Root>((value) => value.value.length), candidateDigest: (value) => value.value,
      rawFingerprint: (value) => JSON.stringify(value), newCapabilityId: () => "unused", preview: (value) => value.value,
    });
    const assessed = await coordinator.assess(root("candidate"));
    const result = step === "observe" || step === "acquire" ? assessed : assessed.ok ? await coordinator.commit({ candidate: root("candidate"), mode: "normal", ticket: assessed.value.ticket }) : assessed;
    assert.deepEqual(result, { ok: false, error: protocolError }, step);
    assert.equal(rootWrites, 0, step);
  }
});

test("post-commit release failure is not reported as plain committed", async () => {
  const harness = createHarness();
  const assessed = await harness.coordinator.assess(root("candidate"));
  assert.equal(assessed.ok, true);
  if (!assessed.ok) return;
  harness.failControlWriteAt(2);
  const result = await harness.coordinator.commit({ candidate: root("candidate"), mode: "normal", ticket: assessed.value.ticket });
  assert.equal(result.ok && result.value.kind, "committed-finalization-required");
  assert.equal(harness.writes().root, 1);
});

test("post-commit tickets retain their opaque pending state for finalize-only retry", async () => {
  for (const failure of ["release", "control-write"] as const) {
    const harness = createHarness();
    const assessed = await harness.coordinator.assess(root("candidate"));
    assert.equal(assessed.ok, true, failure);
    if (!assessed.ok) continue;
    if (failure === "release") harness.failRelease();
    else harness.failControlWriteAt(2);
    const committed = await harness.coordinator.commit({ candidate: root("candidate"), mode: "normal", ticket: assessed.value.ticket });
    assert.equal(committed.ok && committed.value.kind, "committed-finalization-required", failure);
    if (!committed.ok || committed.value.kind !== "committed-finalization-required") continue;
    assert.equal(harness.writes().root, 1, failure);
    harness.allowRelease();
    harness.allowControlWrites();
    const finalized = await harness.coordinator.finalize(committed.value.finalization);
    assert.equal(finalized.ok, true, failure);
    assert.equal(harness.writes().root, 1, failure);
    assert.ok(harness.persistentControl() instanceof SyntheticControl, failure);
    assert.equal(harness.persistentControl().phase, "clear", failure);
  }
});
