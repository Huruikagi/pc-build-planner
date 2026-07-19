// @ts-nocheck Node 26 の type stripping で TypeScript fixture を直接検証する。
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNearQuotaFoundationRoot,
  measureFoundationPerformance,
  PERFORMANCE_OPERATION_NAMES,
} from "../fixtures/performance.ts";

test("10MB近傍の架空rootについて全処理の時間とbytesをreportする", async (t) => {
  const root = buildNearQuotaFoundationRoot();
  const report = await measureFoundationPerformance(root);

  t.diagnostic(`foundation-performance ${JSON.stringify(report)}`);
  assert.deepEqual(
    report.measurements.map(({ operation }) => operation),
    PERFORMANCE_OPERATION_NAMES,
  );
  assert.equal(report.measurements.length, 6);
  assert.ok(report.rootBytes >= 9 * 1024 * 1024);
  assert.ok(report.rootBytes <= 10 * 1024 * 1024);
  for (const measurement of report.measurements) {
    assert.ok(Number.isFinite(measurement.durationMs));
    assert.ok(measurement.durationMs >= 0);
    assert.ok(measurement.bytes >= 9 * 1024 * 1024);
    assert.ok(measurement.bytes <= 10 * 1024 * 1024);
  }
});
