import assert from "node:assert/strict";
import test from "node:test";

import {
  createTransactionEngine,
  type CapacityPolicy,
  type CoreError,
  type CoreResult,
  type ExclusiveLockPort,
  type LocalDataPolicy,
  type StoragePort,
} from "../src/index.js";

interface SyntheticRoot {
  readonly revision: number;
  readonly value: string;
  readonly valid: boolean;
}

type Operation = { readonly value: string };
type Control = { readonly active: boolean };

const root = (value = "before"): SyntheticRoot => ({
  revision: 4,
  value,
  valid: true,
});

const createHarness = (failure?: string) => {
  let stored: unknown = root();
  let writes = 0;
  const events: string[] = [];
  let decodeCalls = 0;

  const storage: StoragePort<SyntheticRoot, Control> = {
    async readRoot() {
      events.push("read");
      if (failure === "read") return { ok: false, error: { code: "storage-unavailable" } };
      if (failure === "read-throw") throw { secret: stored };
      return { ok: true, value: stored };
    },
    async writeRoot(candidate) {
      events.push("write");
      writes += 1;
      if (failure === "write") return { ok: false, error: { code: "quota-exceeded" } };
      if (failure === "write-throw") throw new Error("must stay private");
      stored = candidate;
      return { ok: true, value: undefined };
    },
    async bytesInUse() {
      events.push("bytes");
      if (failure === "bytes") return { ok: false, error: { code: "storage-unavailable" } };
      return { ok: true, value: 100 };
    },
    quotaBytes() {
      events.push("quota");
      if (failure === "quota-throw") throw "private quota failure";
      return 1_000;
    },
    async readControl() { return { ok: true, value: undefined }; },
    async writeControl() { return { ok: true, value: undefined }; },
    async restrictToTrustedContexts() { return { ok: true, value: undefined }; },
  };

  const policy: LocalDataPolicy<SyntheticRoot, Operation, Control, CoreError> = {
    decodeAndMigrate(input) {
      decodeCalls += 1;
      events.push(decodeCalls === 1 ? "decode" : "validate");
      if (failure === "decode") return { ok: false, error: { code: "validation" } };
      if (failure === "migration") return { ok: false, error: { code: "migration" } };
      if (failure === "validation" && decodeCalls === 2) {
        return { ok: false, error: { code: "validation" } };
      }
      if (failure === "decode-throw") throw { root: input };
      if (typeof input !== "object" || input === null || !("valid" in input)) {
        return { ok: false, error: { code: "validation" } };
      }
      return { ok: true, value: input as SyntheticRoot };
    },
    apply(current, operation) {
      events.push("apply");
      if (failure === "apply") return { ok: false, error: { code: "validation" } };
      return { ok: true, value: { ...current, value: operation.value } };
    },
    repair(candidate) {
      events.push("repair");
      if (failure === "repair") return { ok: false, error: { code: "repair" } };
      return { ok: true, value: candidate };
    },
    revision(candidate) {
      if (failure === "revision-throw") {
        throw { message: "private revision failure", root: candidate };
      }
      return candidate.revision;
    },
    withRevision: (candidate, revision) => ({ ...candidate, revision }),
    requestRecord: () => undefined,
    withRequestRecord: (candidate) => candidate,
    control: () => ({ active: false }),
    withControl: (candidate) => candidate,
  };

  const capacity: CapacityPolicy<SyntheticRoot> = {
    assess(beforeBytes, candidate, quotaBytes) {
      events.push("capacity");
      if (failure === "capacity") return { ok: false, error: { code: "quota-exceeded" } };
      return {
        ok: true,
        value: {
          beforeBytes,
          afterBytes: candidate.value.length,
          warningThresholdBytes: 800,
          quotaBytes,
          warning: false,
        },
      };
    },
  };

  const lock: ExclusiveLockPort = {
    async runExclusive(operation) {
      events.push("lock");
      if (failure === "lock") return { ok: false, error: { code: "lock-unavailable" } };
      if (failure === "lock-throw") throw { stored };
      return { ok: true, value: await operation() };
    },
  };

  return {
    engine: createTransactionEngine({ storage, lock, policy, capacity }),
    events,
    getStored: () => stored,
    getWrites: () => writes,
  };
};

test("latest root is validated, mutated, repaired, revalidated, assessed, and written once", async () => {
  const harness = createHarness();
  const result = await harness.engine.execute({
    requestId: "request-1",
    expectedRevision: 4,
    operation: { value: "after" },
  });

  assert.deepEqual(result, {
    ok: true,
    value: {
      revision: 4,
      value: root("after"),
      capacity: {
        beforeBytes: 100,
        afterBytes: 5,
        warningThresholdBytes: 800,
        quotaBytes: 1_000,
        warning: false,
      },
      deduplicated: false,
    },
  });
  assert.equal(harness.getWrites(), 1);
  assert.deepEqual(harness.events, [
    "lock", "read", "decode", "apply", "repair", "validate",
    "bytes", "quota", "capacity", "write",
  ]);
});

test("every typed pre-commit failure preserves the stored root and writes zero times", async () => {
  for (const [failure, code] of [
    ["lock", "lock-unavailable"],
    ["read", "storage-unavailable"],
    ["decode", "validation"],
    ["migration", "migration"],
    ["apply", "validation"],
    ["repair", "repair"],
    ["validation", "validation"],
    ["bytes", "storage-unavailable"],
    ["capacity", "quota-exceeded"],
  ] as const) {
    const harness = createHarness(failure);
    const before = structuredClone(harness.getStored());
    assert.deepEqual(
      await harness.engine.execute({ requestId: "request", expectedRevision: 4, operation: { value: "after" } }),
      { ok: false, error: { code } },
      failure,
    );
    assert.deepEqual(harness.getStored(), before, failure);
    assert.equal(harness.getWrites(), 0, failure);
  }
});

test("storage commit rejection is typed and does not replace the existing root", async () => {
  for (const failure of ["write", "write-throw"]) {
    const harness = createHarness(failure);
    const before = structuredClone(harness.getStored());
    const result = await harness.engine.execute({
      requestId: "request",
      expectedRevision: 4,
      operation: { value: "after" },
    });
    assert.deepEqual(result, {
      ok: false,
      error: { code: failure === "write" ? "quota-exceeded" : "storage-unavailable" },
    });
    assert.deepEqual(harness.getStored(), before);
    assert.equal(harness.getWrites(), 1);
  }
});

test("unknown exceptions are reduced to stable codes without exposing roots or exception values", async () => {
  for (const [failure, code] of [
    ["lock-throw", "lock-unavailable"],
    ["read-throw", "storage-unavailable"],
    ["decode-throw", "validation"],
    ["quota-throw", "storage-unavailable"],
  ] as const) {
    const harness = createHarness(failure);
    const result = await harness.engine.execute({
      requestId: "request",
      expectedRevision: 4,
      operation: { value: "after" },
    });
    assert.deepEqual(result, { ok: false, error: { code } });
    assert.equal(JSON.stringify(result).includes("before"), false);
    assert.equal(harness.getWrites(), 0);
  }
});

test("receipt revision failure occurs before commit and exposes neither exception nor root", async () => {
  const harness = createHarness("revision-throw");
  const before = structuredClone(harness.getStored());
  const result = await harness.engine.execute({
    requestId: "request",
    expectedRevision: 4,
    operation: { value: "after" },
  });

  assert.deepEqual(result, { ok: false, error: { code: "validation" } });
  assert.equal(harness.getWrites(), 0);
  assert.deepEqual(harness.getStored(), before);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("private revision failure"), false);
  assert.equal(serialized.includes("before"), false);
  assert.equal(serialized.includes("after"), false);
});
