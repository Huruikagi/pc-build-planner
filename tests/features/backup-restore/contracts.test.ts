import assert from "node:assert/strict";
import test from "node:test";

import type { FoundationErrorCode } from "../../../src/domain/public.js";
import { mapFoundationError } from "../../../src/features/backup-restore/contracts.js";
import {
  buildCurrentBackupEnvelope,
  buildEmptyBackupEnvelope,
  buildFutureVersionEnvelope,
} from "../../fixtures/backup.js";

test("現行形式Envelopeは製品識別子と形式版を保持し、保存schemaVersionを含まない", () => {
  const envelope = buildCurrentBackupEnvelope();

  assert.equal(envelope.product, "pc-build-planner");
  assert.equal(envelope.formatVersion, 1);
  assert.equal("schemaVersion" in envelope, false);
  assert.equal(envelope.data.projects.length, 1);
  assert.equal(envelope.data.parts.length, 1);
  assert.equal(envelope.data.currentBuilds.length, 1);
});

test("空データのEnvelopeも復元可能な形状を保つ", () => {
  const envelope = buildEmptyBackupEnvelope();

  assert.deepEqual(envelope.data, {
    projects: [],
    parts: [],
    currentBuilds: [],
  });
});

test("将来形式版fixtureは現行形式版と異なる値を示す", () => {
  const future = buildFutureVersionEnvelope() as { formatVersion: number };

  assert.equal(future.formatVersion, 2);
});

test("FoundationErrorの全codeが値を含まずfeature codeへ写像される", () => {
  const expected: Record<FoundationErrorCode, string> = {
    validation: "invalid-structure",
    "corrupt-data": "corrupt-current-data",
    "unsupported-version": "unsupported-version",
    "migration-failed": "invalid-structure",
    "repair-failed": "invalid-reference",
    "revision-conflict": "stale-ticket",
    "request-conflict": "stale-ticket",
    "maintenance-active": "maintenance-active",
    "stale-fence": "stale-ticket",
    "stale-assessment": "stale-ticket",
    "quota-exceeded": "quota-exceeded",
    "access-denied": "storage-unavailable",
    "lock-unavailable": "storage-unavailable",
    "storage-unavailable": "storage-unavailable",
  };

  for (const code of Object.keys(expected) as FoundationErrorCode[]) {
    const mapped = mapFoundationError({ code });
    assert.equal(mapped.code, expected[code]);
    assert.equal("path" in mapped, false, `${code} must not include path`);
  }
});

test("FoundationErrorのmessageは写像結果へ引き継がれない", () => {
  const mapped = mapFoundationError({
    code: "quota-exceeded",
    message: "架空の機微メッセージ",
  });

  assert.deepEqual(mapped, { code: "quota-exceeded" });
});
