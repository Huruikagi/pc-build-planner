import assert from "node:assert/strict";
import test from "node:test";

import type {
  FoundationError,
  LocalDataRoot,
  UtcTimestamp,
} from "../../../src/domain/public.js";
import { exchangeMapper } from "../../../src/features/backup-restore/exchange.js";
import {
  createBackupService,
  createRestoreService,
} from "../../../src/features/backup-restore/service.js";
import type {
  FoundationDataPort,
  FoundationScopedDataPort,
  ReplacementAssessment,
} from "../../../src/persistence/public.js";
import {
  buildCorruptBackupEnvelopes,
  buildCurrentBackupEnvelope,
  buildEmptyBackupEnvelope,
  buildFutureVersionEnvelope,
} from "../../fixtures/backup.js";
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

const FAKE_ASSESSMENT = {
  token: "fake-token",
  candidateDigest: "fake-digest",
  sourceSchemaVersion: 1,
  targetSchemaVersion: 1,
  beforeBytes: 100,
  requiredBytes: 222,
  warnings: [],
  cursor: {
    sourceSchemaVersion: 1,
    targetSchemaVersion: 1,
    requiredBytes: 222,
    revision: 0,
  },
} as unknown as ReplacementAssessment;

const notExpected = (label: string) => (): never => {
  throw new Error(`RestoreService preflight must not call ${label}`);
};

const foundationDataAssessing = (
  assess: (
    candidate: unknown,
  ) => ReturnType<FoundationDataPort["assessReplacement"]>,
): FoundationDataPort => ({
  query: notExpected("query"),
  mutate: notExpected("mutate"),
  assessReplacement: assess,
  replaceRoot: notExpected("replaceRoot"),
  runMaintenance: notExpected("runMaintenance"),
});

const dataAssessingWith = (
  result: Awaited<ReturnType<FoundationDataPort["assessReplacement"]>>,
): FoundationDataPort => foundationDataAssessing(async () => result);

const restoreInputFor = (envelope: unknown) => {
  const text = JSON.stringify(envelope);
  return {
    text,
    byteLength: new TextEncoder().encode(text).byteLength,
  };
};

test("有効な現行envelopeのpreflightはticketとpreviewを返す", async () => {
  const envelope = buildCurrentBackupEnvelope();
  const service = createRestoreService({
    data: dataAssessingWith({ ok: true, value: FAKE_ASSESSMENT }),
  });

  const result = await service.preflight(restoreInputFor(envelope));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.assessment, FAKE_ASSESSMENT);
  assert.deepEqual(result.value.preview, {
    createdAt: envelope.createdAt,
    formatVersion: envelope.formatVersion,
    projectCount: 1,
    partCount: 1,
    currentBuildCount: 1,
    estimatedBytes: FAKE_ASSESSMENT.requiredBytes,
  });
  const expectedCandidate = exchangeMapper.toRoot(envelope);
  assert.equal(expectedCandidate.ok, true);
  if (expectedCandidate.ok)
    assert.deepEqual(result.value.candidate, expectedCandidate.value);
});

test("空データenvelopeのpreflightも成功しpreview件数が0になる", async () => {
  const envelope = buildEmptyBackupEnvelope();
  const service = createRestoreService({
    data: dataAssessingWith({ ok: true, value: FAKE_ASSESSMENT }),
  });

  const result = await service.preflight(restoreInputFor(envelope));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.preview.projectCount, 0);
  assert.equal(result.value.preview.partCount, 0);
  assert.equal(result.value.preview.currentBuildCount, 0);
});

test("読取前サイズ上限を超えるとJSON解析なしでsize-exceededを返す", async () => {
  const service = createRestoreService({
    data: foundationDataAssessing(notExpected("assessReplacement")),
  });

  const result = await service.preflight({
    text: "irrelevant",
    byteLength: 10 * 1024 * 1024 + 1,
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.error, { code: "size-exceeded" });
});

test("JSONとして解析できない入力はnot-jsonとして拒否される", async () => {
  const service = createRestoreService({
    data: foundationDataAssessing(notExpected("assessReplacement")),
  });

  const result = await service.preflight({
    text: "{not valid json",
    byteLength: 15,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "not-json");
    assert.equal(result.error.path, "$");
  }
});

test("将来形式版はwriteなしでunsupported-versionとして拒否される", async () => {
  const service = createRestoreService({
    data: foundationDataAssessing(notExpected("assessReplacement")),
  });

  const result = await service.preflight(
    restoreInputFor(buildFutureVersionEnvelope()),
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "unsupported-version");
    assert.equal(result.error.path, "$.formatVersion");
  }
});

// "unsupported format version"はExchangeMigration経由だとunsupported-versionとして
// より正確に拒否される（専用testで別途確認済み）ため、ここではvalidator直呼び出し
// 前提のexpectedCodeと一致しないこの1件だけ対象から除く。
const preflightCorruptEnvelopes = buildCorruptBackupEnvelopes().filter(
  (corrupt) => corrupt.name !== "unsupported format version",
);

for (const corrupt of preflightCorruptEnvelopes) {
  test(`不正envelope（${corrupt.name}）はwriteなしで値を含まず拒否される`, async () => {
    const service = createRestoreService({
      data: foundationDataAssessing(notExpected("assessReplacement")),
    });

    const result = await service.preflight(restoreInputFor(corrupt.envelope));

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, corrupt.expectedCode);
      assert.equal(result.error.path, corrupt.expectedPath);
    }
  });
}

test("Foundationのassessが容量超過を返した場合はwriteなしで値を含まず拒否される", async () => {
  const envelope = buildCurrentBackupEnvelope();
  const service = createRestoreService({
    data: dataAssessingWith({ ok: false, error: { code: "quota-exceeded" } }),
  });

  const result = await service.preflight(restoreInputFor(envelope));

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.deepEqual(result.error, { code: "quota-exceeded" });
  }
});

test("Foundationのassessがstale-assessmentを返した場合はstale-ticketへ写像される", async () => {
  const envelope = buildCurrentBackupEnvelope();
  const service = createRestoreService({
    data: dataAssessingWith({
      ok: false,
      error: { code: "stale-assessment" },
    }),
  });

  const result = await service.preflight(restoreInputFor(envelope));

  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.error, { code: "stale-ticket" });
});
