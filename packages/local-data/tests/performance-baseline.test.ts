import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import {
  createCapacityPolicy,
  createFencingPolicy,
  createTransactionEngine,
  type CoreError,
  type CoreResult,
  type FenceControlState,
  type LocalDataPolicy,
  type RequestRecord,
  type StoragePort,
} from "../src/index.js";

const MEBIBYTE = 1024 * 1024;
const STAGE_CODES = Object.freeze([
  "decode",
  "migrate",
  "apply",
  "repair",
  "revalidate",
  "capacity",
  "serialize",
  "precommit-decode",
  "write",
]);

// The pre-extraction foundation fixture completed the same near-quota stages in
// milliseconds. These deliberately generous fixed ceilings detect missing or
// pathological stages without turning normal host variance into flaky tests.
const BASELINE = Object.freeze({
  code: "LD-PERF-BASELINE-V1",
  minimumBytes: 9 * MEBIBYTE,
  maximumBytes: 10 * MEBIBYTE,
  maximumStageMs: 5_000,
  maximumTotalMs: 15_000,
});

type SyntheticRoot = Readonly<{
  revision: number;
  valid: true;
  padding: string;
  requests: Readonly<Record<string, RequestRecord>>;
  control: FenceControlState;
}>;
type Operation = Readonly<{ append: string }>;

const encoder = new TextEncoder();
const bytes = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength;

const nearQuotaRoot = (): SyntheticRoot => {
  const base: SyntheticRoot = {
    revision: 1,
    valid: true,
    padding: "",
    requests: {},
    control: { active: false, generation: 0 },
  };
  const target = Math.floor(9.5 * MEBIBYTE);
  return { ...base, padding: "x".repeat(target - bytes(base)) };
};

test("10MB近傍synthetic rootの実transaction baselineを記録・検査する", async (t) => {
  const measurements: Array<{ code: string; durationMs: number }> = [];
  const calls: string[] = [];
  const measure = <Value>(code: string, operation: () => Value): Value => {
    calls.push(code);
    const started = performance.now();
    const value = operation();
    measurements.push({ code, durationMs: performance.now() - started });
    return value;
  };
  const ok = <Value>(value: Value): CoreResult<Value, CoreError> => ({
    ok: true,
    value,
  });

  let stored: unknown = nearQuotaRoot();
  let writes = 0;
  let decodeCalls = 0;
  const storage: StoragePort<SyntheticRoot, FenceControlState> = {
    async readRoot() {
      return { ok: true, value: stored };
    },
    async writeRoot(root) {
      calls.push("write");
      const started = performance.now();
      stored = structuredClone(root);
      writes += 1;
      measurements.push({ code: "write", durationMs: performance.now() - started });
      return { ok: true, value: undefined };
    },
    async readControl() {
      return { ok: true, value: { active: false, generation: 0 } };
    },
    async writeControl() {
      return { ok: true, value: undefined };
    },
    async bytesInUse() {
      return { ok: true, value: bytes(stored) };
    },
    quotaBytes() {
      return 10 * MEBIBYTE;
    },
    async restrictToTrustedContexts() {
      return { ok: true, value: undefined };
    },
  };

  const decode = (input: unknown): CoreResult<SyntheticRoot, CoreError> => {
    decodeCalls += 1;
    const code =
      decodeCalls === 1
        ? "decode"
        : decodeCalls === 2
          ? "revalidate"
          : "precommit-decode";
    return measure(code, () => {
      if (
        typeof input !== "object" ||
        input === null ||
        !("valid" in input) ||
        input.valid !== true
      ) {
        return { ok: false, error: { code: "validation" } };
      }
      return ok(input as SyntheticRoot);
    });
  };
  const policy: LocalDataPolicy<
    SyntheticRoot,
    Operation,
    FenceControlState,
    CoreError
  > = {
    decodeFailureStage: () => "decode",
    decodeAndMigrate(input) {
      const decoded = decode(input);
      return decodeCalls === 1 ? measure("migrate", () => decoded) : decoded;
    },
    apply(root, operation) {
      return measure("apply", () => ok({ ...root, padding: root.padding + operation.append }));
    },
    repair(root) {
      return measure("repair", () => ok(root));
    },
    revision: (root) => root.revision,
    withRevision: (root, revision) => ({ ...root, revision }),
    requestRecord: (root, requestId) => root.requests[requestId],
    withRequestRecord: (root, record) => ({
      ...root,
      requests: { ...root.requests, [record.requestId]: record },
    }),
    control: (root) => root.control,
    withControl: (root, control) => ({ ...root, control }),
  };
  const baseCapacity = createCapacityPolicy<SyntheticRoot>((candidate) =>
    measure("serialize", () => bytes(candidate)),
  );
  const engine = createTransactionEngine<
    SyntheticRoot,
    Operation,
    FenceControlState
  >({
    storage,
    lock: {
      async runExclusive(operation) {
        return { ok: true, value: await operation() };
      },
    },
    policy,
    capacity: {
      assess(currentBytes, candidate, quotaBytes) {
        return measure("capacity", () =>
          baseCapacity.assess(currentBytes, candidate, quotaBytes),
        );
      },
    },
    digest: ({ append }) => `append-${append.length}`,
    now: () => 1,
    fencing: createFencingPolicy<SyntheticRoot>({
      revision: (root) => root.revision,
      read: (root) => root.control,
      write: (root, control) => ({ ...root, control }),
    }),
    persistentControl: {
      authorizeMutation: () => ok(undefined),
    },
    errors: {
      fromPolicy: (_stage, error) => ({ ok: true, value: error }),
      fromCore: (error) => ({ ok: true, value: error }),
    },
  });

  const started = performance.now();
  const result = await engine.execute({
    requestId: "synthetic-request",
    expectedRevision: 1,
    operation: { append: "z" },
  });
  const totalMs = performance.now() - started;
  const rootBytes = bytes(stored);

  t.diagnostic(
    JSON.stringify({ code: BASELINE.code, rootBytes, measurements, totalMs }),
  );
  assert.equal(result.ok, true);
  assert.equal(writes, 1);
  assert.deepEqual(calls, STAGE_CODES);
  assert.ok(rootBytes >= BASELINE.minimumBytes);
  assert.ok(rootBytes <= BASELINE.maximumBytes);
  assert.ok(totalMs <= BASELINE.maximumTotalMs);
  for (const measurement of measurements) {
    assert.ok(Number.isFinite(measurement.durationMs));
    assert.ok(measurement.durationMs <= BASELINE.maximumStageMs);
  }
});
