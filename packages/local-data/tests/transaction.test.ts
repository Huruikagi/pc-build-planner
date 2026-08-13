import assert from "node:assert/strict";
import test from "node:test";

import {
  createTransactionEngine,
  type CapacityPolicy,
  type CoreError,
  type CoreResult,
  type ExclusiveLockPort,
  type FenceControlState,
  createFencingPolicy,
  type LocalDataPolicy,
  type StoragePort,
} from "../src/index.js";

interface SyntheticRoot {
  readonly revision: number;
  readonly value: string;
  readonly valid: boolean;
  readonly requests: Readonly<Record<string, { requestId: string; digest: string; revision: number }>>;
  readonly control: FenceControlState;
}

type Operation = { readonly value: string };
type Control = FenceControlState;

const root = (value = "before"): SyntheticRoot => ({
  revision: 4,
  value,
  valid: true,
  requests: {},
  control: { active: false, generation: 0 },
});

const createHarness = (
  failure?: string,
  beforeRead?: (readCount: number, current: SyntheticRoot) => SyntheticRoot,
) => {
  let stored: unknown = root();
  let writes = 0;
  const events: string[] = [];
  let decodeCalls = 0;
  let readCount = 0;

  const storage: StoragePort<SyntheticRoot, Control> = {
    async readRoot() {
      events.push("read");
      readCount += 1;
      if (beforeRead && typeof stored === "object" && stored !== null) {
        stored = beforeRead(readCount, stored as SyntheticRoot);
      }
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
    requestRecord: (candidate, requestId) => candidate.requests[requestId],
    withRequestRecord: (candidate, record) => ({
      ...candidate,
      requests: { ...candidate.requests, [record.requestId]: record },
    }),
    control: (candidate) => candidate.control,
    withControl: (candidate, control) => ({ ...candidate, control }),
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

  let lockTail = Promise.resolve();
  const lock: ExclusiveLockPort = {
    async runExclusive(operation) {
      events.push("lock");
      if (failure === "lock") return { ok: false, error: { code: "lock-unavailable" } };
      if (failure === "lock-throw") throw { stored };
      const previous = lockTail;
      let release: () => void = () => {};
      lockTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return { ok: true, value: await operation() };
      } finally {
        release();
      }
    },
  };

  const dependencies = {
    storage,
    lock,
    policy,
    capacity,
    digest: (operation: Operation) => {
      if (failure === "digest-throw") throw new Error(`private:${operation.value}`);
      return `value:${operation.value}`;
    },
    now: () => 100,
    fencing: createFencingPolicy<SyntheticRoot>({
      revision: (candidate) => candidate.revision,
      read: (candidate) => candidate.control,
      write: (candidate, control) => ({ ...candidate, control }),
    }),
  };
  return {
    engine: createTransactionEngine(dependencies),
    createEngine: () => createTransactionEngine(dependencies),
    events,
    getStored: () => stored,
    getWrites: () => writes,
  };
};

test("latest root is validated, mutated, repaired, revalidated, revisioned, recorded, assessed, and written once", async () => {
  const harness = createHarness();
  const result = await harness.engine.execute({
    requestId: "request-1",
    expectedRevision: 4,
    operation: { value: "after" },
  });

  assert.deepEqual(result, {
    ok: true,
    value: {
      revision: 5,
      value: {
        ...root("after"),
        revision: 5,
        requests: { "request-1": { requestId: "request-1", digest: "value:after", revision: 5 } },
      },
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
    "bytes", "quota", "capacity", "read", "validate", "write",
  ]);
});

test("persistent request records deduplicate the same request across regenerated engines", async () => {
  const harness = createHarness();
  const command = { requestId: "request-1", expectedRevision: 4, operation: { value: "after" } };
  const first = await harness.engine.execute(command);
  const second = await harness.createEngine().execute(command);

  assert.equal(first.ok && first.value.revision, 5);
  assert.equal(second.ok && second.value.revision, 5);
  assert.equal(second.ok && second.value.deduplicated, true);
  assert.equal(harness.getWrites(), 1);
  assert.equal(harness.events.filter((event) => event === "apply").length, 1);
});

test("request conflicts, stale revisions, and active fences reject before mutation and write", async () => {
  for (const [setup, command, code] of [
    [
      async (harness: ReturnType<typeof createHarness>) => {
        await harness.engine.execute({ requestId: "request", expectedRevision: 4, operation: { value: "first" } });
      },
      { requestId: "request", expectedRevision: 5, operation: { value: "different" } },
      "request-conflict",
    ],
    [async () => undefined, { requestId: "stale", expectedRevision: 3, operation: { value: "after" } }, "revision-conflict"],
  ] as const) {
    const harness = createHarness();
    await setup(harness);
    const writesBefore = harness.getWrites();
    const appliesBefore = harness.events.filter((event) => event === "apply").length;
    assert.deepEqual(await harness.engine.execute(command), { ok: false, error: { code } });
    assert.equal(harness.getWrites(), writesBefore);
    assert.equal(harness.events.filter((event) => event === "apply").length, appliesBefore);
  }

  const fenced = createHarness();
  const current = fenced.getStored() as SyntheticRoot;
  Object.assign(current, {
    control: {
      active: true,
      kind: "maintenance",
      owner: "worker-a",
      generation: 1,
      leaseExpiresAt: 200,
      revision: 4,
    },
  });
  assert.deepEqual(
    await fenced.engine.execute({ requestId: "fenced", expectedRevision: 4, operation: { value: "after" } }),
    { ok: false, error: { code: "maintenance-active" } },
  );
  assert.equal(fenced.getWrites(), 0);
  assert.equal(fenced.events.includes("apply"), false);
});

test("concurrent clients serialize and each successful mutation advances revision by exactly one", async () => {
  const harness = createHarness();
  const results = await Promise.all([
    harness.engine.execute({ requestId: "one", expectedRevision: 4, operation: { value: "one" } }),
    harness.engine.execute({ requestId: "two", expectedRevision: 5, operation: { value: "two" } }),
  ]);

  assert.deepEqual(results.map((result) => result.ok && result.value.revision), [5, 6]);
  assert.equal(harness.getWrites(), 2);
  assert.equal((harness.getStored() as SyntheticRoot).revision, 6);
});

test("precommit latest-state checks reject revision, request, and fence races without writing", async () => {
  const cases: ReadonlyArray<readonly [string, (current: SyntheticRoot) => SyntheticRoot, CoreError["code"]]> = [
    ["revision", (current) => ({ ...current, revision: 5 }), "revision-conflict"],
    [
      "request",
      (current) => ({
        ...current,
        requests: { request: { requestId: "request", digest: "value:other", revision: 5 } },
      }),
      "request-conflict",
    ],
    [
      "fence",
      (current) => ({
        ...current,
        control: {
          active: true,
          kind: "recovery",
          owner: "new-runtime",
          generation: 2,
          leaseExpiresAt: 200,
          revision: 4,
        },
      }),
      "recovery-active",
    ],
    [
      "stale fence owner",
      (current) => ({
        ...current,
        control: { active: true, kind: "maintenance", owner: "", generation: 2, leaseExpiresAt: 200, revision: 4 },
      }),
      "stale-fence",
    ],
    [
      "stale fence generation",
      (current) => ({
        ...current,
        control: { active: true, kind: "maintenance", owner: "worker", generation: 0, leaseExpiresAt: 200, revision: 4 },
      }),
      "stale-fence",
    ],
    [
      "stale fence revision",
      (current) => ({
        ...current,
        control: { active: true, kind: "maintenance", owner: "worker", generation: 2, leaseExpiresAt: 200, revision: 3 },
      }),
      "stale-fence",
    ],
  ];
  for (const [name, change, code] of cases) {
    const harness = createHarness(undefined, (readCount, current) =>
      readCount === 2 ? change(current) : current,
    );
    assert.deepEqual(
      await harness.engine.execute({ requestId: "request", expectedRevision: 4, operation: { value: "after" } }),
      { ok: false, error: { code } },
      name,
    );
    assert.equal(harness.getWrites(), 0, name);
  }
});

test("digest callback exceptions are normalized without leaking operation or writing", async () => {
  const harness = createHarness("digest-throw");
  const result = await harness.engine.execute({
    requestId: "request",
    expectedRevision: 4,
    operation: { value: "secret-operation" },
  });
  assert.deepEqual(result, { ok: false, error: { code: "validation" } });
  assert.equal(JSON.stringify(result).includes("secret-operation"), false);
  assert.equal(harness.getWrites(), 0);
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
