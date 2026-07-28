import assert from "node:assert/strict";
import test from "node:test";
import { backupExchangeV2 } from "../../../src/features/backup-restore/exchange-v2.js";
import { buildCurrentBackupEnvelope } from "../../fixtures/backup.js";
import { sourceRootV2 } from "../../fixtures/candidate-source-root-v2.js";

test("format 1を決定的なformat 2 sourceへ移行する", () => {
  const legacy = buildCurrentBackupEnvelope();
  const first = backupExchangeV2.importEnvelope(legacy);
  const second = backupExchangeV2.importEnvelope(legacy);
  assert.deepEqual(first, second);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.value.schemaVersion, 2);
  const candidate = first.value.candidateParts[0];
  assert.ok(candidate);
  if (candidate.sources.length > 0)
    assert.equal(candidate.primarySourceId, candidate.sources[0]?.id);
});

test("format 2 export/importはsource順序・ID・primary・snapshotを維持する", () => {
  const migrated = backupExchangeV2.importEnvelope(
    buildCurrentBackupEnvelope(),
  );
  assert.equal(migrated.ok, true);
  if (!migrated.ok) return;
  const envelope = backupExchangeV2.exportRoot(
    migrated.value,
    "2026-07-28T00:00:00.000Z" as never,
  );
  const restored = backupExchangeV2.importEnvelope(envelope);
  assert.equal(restored.ok, true);
  if (!restored.ok) return;
  assert.deepEqual(
    restored.value.candidateParts,
    migrated.value.candidateParts,
  );
});

test("存在しないprimary参照はpreflightで拒否する", () => {
  const migrated = backupExchangeV2.importEnvelope(
    buildCurrentBackupEnvelope(),
  );
  assert.equal(migrated.ok, true);
  if (!migrated.ok) return;
  const before = structuredClone(migrated.value);
  const envelope = structuredClone(
    backupExchangeV2.exportRoot(
      migrated.value,
      "2026-07-28T00:00:00.000Z" as never,
    ),
  ) as unknown as { data: { parts: Array<{ primarySourceId?: string }> } };
  const part = envelope.data.parts[0];
  assert.ok(part);
  Object.assign(part, {
    sources: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        pageUrl: "https://example.invalid",
      },
    ],
    primarySourceId: "99999999-9999-4999-8999-999999999999",
  });
  const result = backupExchangeV2.importEnvelope(envelope);
  assert.equal(result.ok, false);
  assert.deepEqual(migrated.value, before);
});

test("format 2の複数sourceを復元して再exportしてもsource意味が一致する", () => {
  const root = sourceRootV2();
  const envelope = backupExchangeV2.exportRoot(
    root,
    "2026-07-28T00:00:00.000Z" as never,
  );
  const restored = backupExchangeV2.importEnvelope(envelope);
  assert.equal(restored.ok, true);
  if (!restored.ok) return;
  assert.deepEqual(
    restored.value.candidateParts.map(({ sources, primarySourceId }) => ({
      sources,
      primarySourceId,
    })),
    root.candidateParts.map(({ sources, primarySourceId }) => ({
      sources,
      primarySourceId,
    })),
  );
});

test("不正sourceのformat 2はpreflightで拒否し既存root値へ触れない", () => {
  const existing = sourceRootV2();
  const before = structuredClone(existing);
  const envelope = structuredClone(
    backupExchangeV2.exportRoot(existing, "2026-07-28T00:00:00.000Z" as never),
  ) as unknown as {
    data: { parts: Array<{ sources: Array<{ pageUrl?: string }> }> };
  };
  const source = envelope.data.parts[0]?.sources[0];
  assert.ok(source);
  source.pageUrl = "javascript:alert(1)";

  const result = backupExchangeV2.importEnvelope(envelope);

  assert.equal(result.ok, false);
  assert.deepEqual(existing, before);
});
