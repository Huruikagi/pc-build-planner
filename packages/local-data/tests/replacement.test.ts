import assert from "node:assert/strict";
import test from "node:test";

import {
  createCapacityPolicy,
  createReplacementCoordinator,
  type CoreError,
  type FenceControlState,
  type LocalDataPolicy,
  type StoragePort,
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

const createHarness = (storedRoot: unknown = root()) => {
  let stored = structuredClone(storedRoot);
  let control: unknown = {
    active: true,
    kind: "recovery",
    owner: "recovery-owner",
    generation: 7,
    leaseExpiresAt: 2_000,
    revision: 0,
  };
  let rootWrites = 0;
  let controlWrites = 0;
  const stages: string[] = [];
  const storage: StoragePort<Root, FenceControlState> = {
    async readRoot() { return { ok: true, value: structuredClone(stored) }; },
    async writeRoot(value) { rootWrites += 1; stored = value; return { ok: true, value: undefined }; },
    async readControl() { return { ok: true, value: structuredClone(control) }; },
    async writeControl(value) { controlWrites += 1; control = value; return { ok: true, value: undefined }; },
    async bytesInUse() { return { ok: true, value: 100 }; },
    quotaBytes: () => 1_000,
    async restrictToTrustedContexts() { return { ok: true, value: undefined }; },
  };
  const policy: LocalDataPolicy<Root, never, FenceControlState, CoreError> = {
    decodeAndMigrate(input) {
      stages.push("decode");
      if (typeof input !== "object" || input === null || !("valid" in input))
        return { ok: false, error: { code: "migration" } };
      const value = input as Root;
      return value.valid
        ? { ok: true, value }
        : { ok: false, error: { code: "validation" } };
    },
    apply: () => ({ ok: false, error: { code: "validation" } }),
    repair(candidate) { stages.push("repair"); return { ok: true, value: { ...candidate, value: candidate.value.trim() } }; },
    revision: (candidate) => candidate.revision,
    withRevision: (candidate, revision) => ({ ...candidate, revision }),
    requestRecord: () => undefined,
    withRequestRecord: (candidate) => candidate,
    control: (candidate) => candidate.control,
    withControl: (candidate, next) => ({ ...candidate, control: next }),
  };
  const coordinator = createReplacementCoordinator({
    storage,
    policy,
    capacity: createCapacityPolicy<Root>((candidate) => candidate.value.length),
    candidateDigest: (candidate) => `digest:${candidate.value}`,
    rawFingerprint: (raw) => `raw:${JSON.stringify(raw)}`,
    preview: (candidate, capacity, mode) => ({ value: candidate.value, bytes: capacity.afterBytes, mode }),
  });
  return {
    coordinator,
    stages,
    writes: () => ({ root: rootWrites, control: controlWrites }),
    setStored(value: unknown) { stored = structuredClone(value); },
    setControl(value: unknown) { control = structuredClone(value); },
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
