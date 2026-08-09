import assert from "node:assert/strict";
import test from "node:test";

import {
  EXCHANGE_FIELD_DIFFS,
  FOUNDATION_ROOT_CAPACITY_BYTES,
  MAX_RESTORABLE_EXPORT_BYTES,
  restoreFileCapacityPolicy,
} from "../../../src/features/backup-restore/capacity-policy.js";

test("16 MiBちょうどを許可し、1 byte超過を拒否する", () => {
  assert.equal(restoreFileCapacityPolicy.accepts(16 * 1024 * 1024), true);
  assert.equal(restoreFileCapacityPolicy.accepts(16 * 1024 * 1024 + 1), false);
});

test("10 MiBのFoundation保存上限と16 MiBの復元入力上限を分離する", () => {
  assert.equal(FOUNDATION_ROOT_CAPACITY_BYTES, 10 * 1024 * 1024);
  assert.ok(
    MAX_RESTORABLE_EXPORT_BYTES <= restoreFileCapacityPolicy.maxInputBytes,
  );
});

test("Mapperのroot/envelope差分を分類し、未分類の可変値を導入しない", () => {
  assert.deepEqual(
    EXCHANGE_FIELD_DIFFS.map((entry) => entry.persisted),
    [
      "schemaVersion",
      "revision",
      "candidateParts",
      "requestDedupe",
      "maintenance",
      null,
      null,
      null,
    ],
  );
  assert.deepEqual(
    EXCHANGE_FIELD_DIFFS.map((entry) => entry.exchange),
    [
      null,
      null,
      "data.parts",
      null,
      null,
      "product",
      "formatVersion",
      "createdAt",
    ],
  );
});
