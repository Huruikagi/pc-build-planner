import assert from "node:assert/strict";
import test from "node:test";

import type {
  FoundationError,
  LocalDataRoot,
  UtcTimestamp,
} from "../../../src/domain/public.js";
import { exchangeMapper } from "../../../src/features/backup-restore/exchange.js";
import { createBackupService } from "../../../src/features/backup-restore/service.js";
import type { FoundationScopedDataPort } from "../../../src/persistence/public.js";
import { buildFoundationRoot } from "../../fixtures/foundation.js";

const NOW = "2026-07-24T03:04:05.000Z" as UtcTimestamp;

const EMPTY_ROOT = {
  schemaVersion: 1,
  revision: 0,
  projects: [],
  candidateParts: [],
  currentBuilds: [],
  requestDedupe: [],
  maintenance: { generation: 0, active: false },
} as unknown as LocalDataRoot;

const mutateNotExpected: FoundationScopedDataPort["mutate"] = () => {
  throw new Error("BackupService must not call mutate");
};

const dataReturning = (root: LocalDataRoot): FoundationScopedDataPort => ({
  query: (async (queryFn) => ({
    ok: true,
    value: queryFn(root),
  })) as FoundationScopedDataPort["query"],
  mutate: mutateNotExpected,
});

const dataFailingWith = (error: FoundationError): FoundationScopedDataPort => ({
  query: (async () => ({
    ok: false,
    error,
  })) as FoundationScopedDataPort["query"],
  mutate: mutateNotExpected,
});

test("全12カテゴリを含むrootからbackup artifactを生成する", async () => {
  const root = buildFoundationRoot();
  const service = createBackupService({
    data: dataReturning(root),
    now: () => NOW,
  });

  const result = await service.create();

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.mimeType, "application/json");
  assert.equal(
    result.value.filename,
    "pc-build-planner-backup-2026-07-24.json",
  );
  const parsed = JSON.parse(result.value.json);
  assert.deepEqual(parsed, exchangeMapper.fromRoot(root, NOW));
  const expectedBytes = new TextEncoder().encode(result.value.json).byteLength;
  assert.equal(result.value.byteLength, expectedBytes);
});

test("空データのrootでも復元可能なartifactを生成する", async () => {
  const service = createBackupService({
    data: dataReturning(EMPTY_ROOT),
    now: () => NOW,
  });

  const result = await service.create();

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const parsed = JSON.parse(result.value.json);
  assert.deepEqual(parsed.data, { projects: [], parts: [], currentBuilds: [] });
});

test("読取が破損データで失敗した場合はartifactを返さない", async () => {
  const service = createBackupService({
    data: dataFailingWith({ code: "corrupt-data" }),
    now: () => NOW,
  });

  const result = await service.create();

  assert.equal(result.ok, false);
  if (!result.ok)
    assert.deepEqual(result.error, { code: "corrupt-current-data" });
});

test("読取が非対応版で失敗した場合はartifactを返さない", async () => {
  const service = createBackupService({
    data: dataFailingWith({ code: "unsupported-version" }),
    now: () => NOW,
  });

  const result = await service.create();

  assert.equal(result.ok, false);
  if (!result.ok)
    assert.deepEqual(result.error, { code: "unsupported-current-data" });
});

test("読取がstorage起因で失敗した場合はartifactを返さない", async () => {
  const service = createBackupService({
    data: dataFailingWith({ code: "storage-unavailable" }),
    now: () => NOW,
  });

  const result = await service.create();

  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.error, { code: "storage" });
});
