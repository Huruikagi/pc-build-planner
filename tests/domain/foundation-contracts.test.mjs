import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import * as identifiers from "../../src/domain/identifiers.ts";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import { err, ok } from "../../src/domain/result.ts";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import * as schema from "../../src/persistence/schema.ts";

const {
  createRequestId,
  createRevision,
  createUtcTimestamp,
  createUuid,
  isRequestId,
  isRevision,
  isUtcTimestamp,
  isUuid,
} = identifiers;
const { createInitialRoot, CURRENT_SCHEMA_VERSION, LOCAL_DATA_STORAGE_KEY } =
  schema;

test("UUIDとrequest IDを生成し、UUID規約を検証する", () => {
  const uuid = createUuid();
  const requestId = createRequestId();

  assert.equal(isUuid(uuid), true);
  assert.equal(isRequestId(requestId), true);
  assert.equal(isUuid("not-a-uuid"), false);
  assert.equal(isUuid("00000000-0000-0000-0000-000000000000"), false);
});

test("UTC ISO 8601日時だけを受理する", () => {
  const timestamp = createUtcTimestamp(new Date("2026-07-18T12:34:56.789Z"));

  assert.equal(timestamp, "2026-07-18T12:34:56.789Z");
  assert.equal(isUtcTimestamp(timestamp), true);
  assert.equal(isUtcTimestamp("2026-07-18T21:34:56.789+09:00"), false);
  assert.equal(isUtcTimestamp("2026-02-30T00:00:00Z"), false);
});

test("revisionは非負のsafe integerに限定する", () => {
  assert.equal(createRevision(0), 0);
  assert.equal(isRevision(42), true);
  assert.equal(isRevision(-1), false);
  assert.equal(isRevision(1.5), false);
  assert.throws(() => createRevision(-1), RangeError);
});

test("canonical Resultは成功と各foundation failureを判別できる", () => {
  const success = ok({ revision: 0 });
  assert.deepEqual(success, { ok: true, value: { revision: 0 } });

  const codes = [
    "validation",
    "corrupt-data",
    "unsupported-version",
    "migration-failed",
    "repair-failed",
    "revision-conflict",
    "request-conflict",
    "maintenance-active",
    "stale-fence",
    "stale-assessment",
    "quota-exceeded",
    "access-denied",
    "storage-unavailable",
  ];

  for (const code of codes) {
    const failure = err({ code });
    assert.equal(failure.ok, false);
    assert.equal(failure.error.code, code);
  }
});

test("初期rootは現行schema version 1・revision 0で生成される", () => {
  assert.equal(CURRENT_SCHEMA_VERSION, 1);
  assert.equal(LOCAL_DATA_STORAGE_KEY, "localDataRoot");
  assert.deepEqual(createInitialRoot(), { schemaVersion: 1, revision: 0 });
});
