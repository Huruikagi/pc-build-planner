import assert from "node:assert/strict";
import test from "node:test";

import {
  createCapacityPolicy,
  createFencingPolicy,
  createTransactionEngine,
  createReplacementCoordinator,
  type CoreError,
  type CapacityStatus,
  type FenceControlState,
  type LocalDataPolicy,
  type StoragePort,
  type ExclusiveLockPort,
  type ReplacementMode,
} from "../src/index.js";

interface Root {
  readonly revision: number;
  readonly value: string;
  readonly valid: boolean;
  readonly control: FenceControlState;
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
) => {
  let stored = structuredClone(storedRoot);
  let control: unknown = "valid" in (storedRoot as object)
    ? structuredClone((storedRoot as Root).control)
    : { active: true, kind: "recovery", owner: "recovery-owner", generation: 7, leaseExpiresAt: 2_000, revision: 0 };
  let rootWrites = 0;
  let controlWrites = 0;
  let failControlWriteAt: number | undefined;
  let failRootWriteAt: number | undefined;
  let capability = 0;
  const stages: string[] = [];
  const storage: StoragePort<Root, FenceControlState> = {
    async readRoot() { return { ok: true, value: structuredClone(stored) }; },
    async writeRoot(value) { rootWrites += 1; if (rootWrites === failRootWriteAt) return { ok: false, error: { code: "storage-unavailable" } }; stored = value; return { ok: true, value: undefined }; },
    async readControl() { return { ok: true, value: structuredClone(control) }; },
    async writeControl(value) { controlWrites += 1; if (controlWrites === failControlWriteAt) return { ok: false, error: { code: "storage-unavailable" } }; control = value; return { ok: true, value: undefined }; },
    async bytesInUse() { return { ok: true, value: 100 }; },
    quotaBytes: () => 1_000,
    async restrictToTrustedContexts() { return { ok: true, value: undefined }; },
  };
  const lock: ExclusiveLockPort = { async runExclusive(operation) { return { ok: true, value: await operation() }; } };
  const policy: LocalDataPolicy<Root, { readonly value: string }, FenceControlState, CoreError> = {
    decodeAndMigrate(input) {
      stages.push("decode");
      if (typeof input !== "object" || input === null || !("valid" in input))
        return { ok: false, error: { code: "migration" } };
      const value = input as Root;
      return value.valid
        ? { ok: true, value }
        : { ok: false, error: { code: "validation" } };
    },
    apply: (candidate, operation) => ({ ok: true, value: { ...candidate, value: operation.value } }),
    repair(candidate) { stages.push("repair"); return { ok: true, value: { ...candidate, value: candidate.value.trim() } }; },
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
    persistentControl: {
      authorizeMutation(value: unknown) {
        if (typeof value !== "object" || value === null) return { ok: false as const, error: { code: "stale-fence" as const } };
        const current = value as Record<string, unknown>;
        if (current.active === false) return { ok: true as const, value: undefined };
        if (current.active === true && current.kind === "maintenance") return { ok: false as const, error: { code: "maintenance-active" as const } };
        if (current.active === true && current.kind === "recovery") return { ok: false as const, error: { code: "recovery-active" as const } };
        return { ok: false as const, error: { code: "stale-fence" as const } };
      },
    },
  });
  return {
    coordinator,
    recreateCoordinator: () => createReplacementCoordinator(dependencies),
    mutate: (expectedRevision: number) => transaction.execute({ requestId: `mutation-${expectedRevision}`, expectedRevision, operation: { value: "mutated" } }),
    stages,
    writes: () => ({ root: rootWrites, control: controlWrites }),
    stored: () => structuredClone(stored) as Root,
    persistentControl: () => structuredClone(control),
    setStored(value: unknown) { stored = structuredClone(value); },
    setControl(value: unknown) { control = structuredClone(value); },
    failControlWriteAt(value: number) { failControlWriteAt = value; },
    allowControlWrites() { failControlWriteAt = undefined; },
    failRootWriteAt(value: number) { failRootWriteAt = value; },
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

test("invalid owner or generation is rejected during assessment without writes", async () => {
  for (const change of [
    (current: Root) => ({ ...current, control: { ...current.control, owner: "" } }),
    (current: Root) => ({ ...current, control: { ...current.control, generation: 0 } }),
  ]) {
    const harness = createHarness(change(root()));
    assert.deepEqual(await harness.coordinator.assess(root("candidate")), {
      ok: false,
      error: { code: "stale-fence" },
    });
    assert.deepEqual(harness.writes(), { root: 0, control: 0 });
  }
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
  assert.equal("__replacementPending" in (harness.persistentControl() as object), false);
});

test("candidate, persisted fingerprint, owner, or generation drift is stale before root write", async () => {
  for (const drift of [
    (h: ReturnType<typeof createHarness>) => h.setStored(root("changed-root")),
    (h: ReturnType<typeof createHarness>) => h.setStored({ ...root(), control: { ...root().control, owner: "other" } }),
    (h: ReturnType<typeof createHarness>) => h.setStored({ ...root(), control: { ...root().control, generation: 3 } }),
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

test("post-write cleanup failure is a committed outcome and finalize-only never rewrites root", async () => {
  const harness = createHarness();
  const candidate = root("candidate");
  const assessed = await harness.coordinator.assess(candidate);
  assert.equal(assessed.ok, true);
  if (!assessed.ok) return;
  harness.failControlWriteAt(2);
  const outcome = await harness.coordinator.commit({ candidate, mode: "normal", ticket: assessed.value.ticket });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.ok && outcome.value.kind, "committed-finalization-required");
  if (!outcome.ok || outcome.value.kind !== "committed-finalization-required") return;
  assert.equal(harness.writes().root, 1);
  harness.allowControlWrites();
  const finalized = await harness.coordinator.finalize(outcome.value.finalization);
  assert.equal(finalized.ok, true);
  assert.equal(harness.writes().root, 1);
});

test("same-ticket precommit retry cleans only, then fully revalidates and commits once", async () => {
  const harness = createHarness();
  const candidate = root("candidate");
  const assessed = await harness.coordinator.assess(candidate);
  assert.equal(assessed.ok, true);
  if (!assessed.ok) return;
  harness.failRootWriteAt(1);
  harness.failControlWriteAt(2);
  assert.deepEqual(await harness.coordinator.commit({ candidate, mode: "normal", ticket: assessed.value.ticket }), {
    ok: false,
    error: { code: "precommit-cleanup-pending" },
  });
  assert.equal(harness.writes().root, 1);
  harness.allowControlWrites();
  assert.deepEqual(await harness.coordinator.commit({ candidate, mode: "normal", ticket: assessed.value.ticket }), {
    ok: false,
    error: { code: "precommit-cleanup-pending" },
  });
  assert.equal(harness.writes().root, 1);
  assert.equal("__replacementPending" in (harness.persistentControl() as object), false);
  const committed = await harness.coordinator.commit({ candidate, mode: "normal", ticket: assessed.value.ticket });
  assert.equal(committed.ok && committed.value.kind, "committed");
  assert.equal(harness.writes().root, 2);
  assert.equal(harness.stored().value, "candidate");
});

test("same-ticket retry revalidates every private binding after precommit cleanup", async () => {
  const driftCases = [
    {
      name: "candidate",
      apply: (harness: ReturnType<typeof createHarness>) => undefined,
      candidate: root("changed-candidate"),
    },
    {
      name: "stored root",
      apply: (harness: ReturnType<typeof createHarness>) => harness.setStored(root("changed-root")),
      candidate: root("candidate"),
    },
    {
      name: "owner",
      apply: (harness: ReturnType<typeof createHarness>) =>
        harness.setControl({ ...root().control, owner: "other-owner" }),
      candidate: root("candidate"),
    },
    {
      name: "generation",
      apply: (harness: ReturnType<typeof createHarness>) =>
        harness.setControl({ ...root().control, generation: 8 }),
      candidate: root("candidate"),
    },
  ] as const;

  for (const drift of driftCases) {
    const harness = createHarness();
    const candidate = root("candidate");
    const assessed = await harness.coordinator.assess(candidate);
    assert.equal(assessed.ok, true, drift.name);
    if (!assessed.ok) continue;
    harness.failRootWriteAt(1);
    harness.failControlWriteAt(2);
    assert.deepEqual(
      await harness.coordinator.commit({ candidate, mode: "normal", ticket: assessed.value.ticket }),
      { ok: false, error: { code: "precommit-cleanup-pending" } },
      drift.name,
    );
    harness.allowControlWrites();
    assert.deepEqual(
      await harness.coordinator.commit({ candidate, mode: "normal", ticket: assessed.value.ticket }),
      { ok: false, error: { code: "precommit-cleanup-pending" } },
      drift.name,
    );
    drift.apply(harness);
    assert.deepEqual(
      await harness.coordinator.commit({ candidate: drift.candidate, mode: "normal", ticket: assessed.value.ticket }),
      { ok: false, error: { code: "stale-assessment" } },
      drift.name,
    );
    assert.equal(harness.writes().root, 1, drift.name);
  }
});

test("duplicate injected capability ids fail closed", async () => {
  const harness = createHarness(root(), () => "duplicate-capability");
  assert.equal((await harness.coordinator.assess(root("first"))).ok, true);
  assert.deepEqual(await harness.coordinator.assess(root("second")), {
    ok: false,
    error: { code: "validation" },
  });
  assert.deepEqual(harness.writes(), { root: 0, control: 0 });
});

test("pending finalization survives coordinator recreation and releases the transaction-visible fence", async () => {
  const harness = createHarness();
  const candidate = root("candidate");
  const assessed = await harness.coordinator.assess(candidate);
  assert.equal(assessed.ok, true);
  if (!assessed.ok) return;
  harness.failControlWriteAt(2);
  const committed = await harness.coordinator.commit({ candidate, mode: "normal", ticket: assessed.value.ticket });
  assert.equal(committed.ok && committed.value.kind, "committed-finalization-required");
  assert.equal(harness.stored().control.active, false);
  assert.equal((harness.persistentControl() as FenceControlState).active, true);
  assert.deepEqual(await harness.mutate(5), {
    ok: false,
    error: { code: "maintenance-active" },
  });
  harness.allowControlWrites();
  const recreated = harness.recreateCoordinator();
  const found = await recreated.findPendingFinalization();
  assert.equal(found.ok && found.value !== null, true);
  if (!found.ok || found.value === null) return;
  const finalized = await recreated.finalize(found.value);
  assert.equal(finalized.ok, true);
  assert.equal(harness.writes().root, 1);
  assert.equal(finalized.ok && finalized.value.root.control.active, false);
  assert.equal((await harness.mutate(5)).ok, true);
});

test("recovery commit uses the same single-write and finalization lifecycle", async () => {
  const harness = createHarness({ corrupt: true });
  const candidate = root("recovered");
  const assessed = await harness.coordinator.assessRecovery(candidate);
  assert.equal(assessed.ok, true);
  if (!assessed.ok) return;
  harness.failControlWriteAt(2);
  const outcome = await harness.coordinator.commit({ candidate, mode: "recovery", ticket: assessed.value.ticket });
  assert.equal(outcome.ok && outcome.value.kind, "committed-finalization-required");
  assert.equal(harness.writes().root, 1);
  assert.equal(harness.stored().control.active, false);
  assert.equal((harness.persistentControl() as FenceControlState).active, true);
  assert.deepEqual(await harness.mutate(5), {
    ok: false,
    error: { code: "recovery-active" },
  });
  assert.equal(harness.writes().root, 1);
  harness.allowControlWrites();
  const recreated = harness.recreateCoordinator();
  const pending = await recreated.findPendingFinalization();
  assert.equal(pending.ok && pending.value !== null, true);
  if (!pending.ok || pending.value === null) return;
  assert.equal((await recreated.finalize(pending.value)).ok, true);
  assert.equal(harness.writes().root, 1);
  assert.equal(harness.stored().control.active, false);
  assert.equal((await harness.mutate(4)).ok, true);
  assert.equal(harness.writes().root, 2);
});

test("a different assessment ticket cannot take over persistent precommit cleanup", async () => {
  const harness = createHarness();
  const candidate = root("candidate");
  const first = await harness.coordinator.assess(candidate);
  const other = await harness.coordinator.assess(candidate);
  assert.equal(first.ok && other.ok, true);
  if (!first.ok || !other.ok) return;
  harness.failRootWriteAt(1);
  harness.failControlWriteAt(2);
  assert.equal((await harness.coordinator.commit({ candidate, mode: "normal", ticket: first.value.ticket })).ok, false);
  harness.allowControlWrites();
  assert.deepEqual(await harness.coordinator.commit({ candidate, mode: "normal", ticket: other.value.ticket }), {
    ok: false,
    error: { code: "recovery-active" },
  });
  assert.equal(harness.writes().root, 1);
});
