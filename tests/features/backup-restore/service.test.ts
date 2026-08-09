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
  BackupRestoreAssessmentTicket,
  BackupRestoreDataPort,
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
const ASSESSMENT_TICKET =
  "00000000-0000-4000-8000-000000000001" as BackupRestoreAssessmentTicket;

const notExpected = (label: string) => (): never => {
  throw new Error(`RestoreService preflight must not call ${label}`);
};

const foundationDataAssessing = (
  assess: (
    candidate: unknown,
  ) => ReturnType<FoundationDataPort["assessReplacement"]>,
): BackupRestoreDataPort => ({
  async assessReplacement(candidate) {
    const result = await assess(candidate);
    return result.ok
      ? {
          ok: true,
          value: {
            mode: "normal",
            requiredBytes: result.value.requiredBytes,
            ticket: ASSESSMENT_TICKET,
          },
        }
      : result;
  },
  assessRecovery: notExpected("assessRecovery"),
  commit: notExpected("commit"),
  findPendingFinalization: notExpected("findPendingFinalization"),
  finalize: notExpected("finalize"),
});

const dataAssessingWith = (
  result: Awaited<ReturnType<FoundationDataPort["assessReplacement"]>>,
): BackupRestoreDataPort => foundationDataAssessing(async () => result);

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
  assert.equal(result.value.assessment, ASSESSMENT_TICKET);
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

const FAKE_TICKET = {
  candidate: { schemaVersion: 1 },
  assessment: ASSESSMENT_TICKET,
  preview: {
    createdAt: NOW,
    formatVersion: 1,
    projectCount: 3,
    partCount: 5,
    currentBuildCount: 2,
    estimatedBytes: FAKE_ASSESSMENT.requiredBytes,
  },
};

const FAKE_FENCE = { generation: 1, ownerId: "owner", revision: 4 };

/** acquire自体もrevisionを進めるため、commitでは取得後のassessmentだけを使用する。 */
const FRESH_ASSESSMENT = {
  ...FAKE_ASSESSMENT,
  candidateDigest: "fresh-digest",
};

interface RecordedCall {
  readonly method: "runMaintenance" | "assessReplacement" | "replaceRoot";
  readonly args: unknown;
}

const foundationDataForCommit = (options: {
  readonly acquire: Awaited<ReturnType<FoundationDataPort["runMaintenance"]>>;
  readonly assessReplacement?: Awaited<
    ReturnType<FoundationDataPort["assessReplacement"]>
  >;
  readonly replaceRoot?: Awaited<ReturnType<FoundationDataPort["replaceRoot"]>>;
  readonly releaseOrAbort?: Awaited<
    ReturnType<FoundationDataPort["runMaintenance"]>
  >;
}): {
  readonly data: BackupRestoreDataPort;
  readonly calls: RecordedCall[];
} => {
  const calls: RecordedCall[] = [];
  const data: BackupRestoreDataPort = {
    assessReplacement: notExpected("assessReplacement"),
    assessRecovery: notExpected("assessRecovery"),
    async commit(command) {
      const acquireCommand = {
        type: "acquire",
        ownerId: crypto.randomUUID(),
        leaseMs: 30_000,
      };
      calls.push({ method: "runMaintenance", args: acquireCommand });
      if (!options.acquire.ok) return options.acquire as never;
      const fence = options.acquire.value.fence;
      if (fence === undefined)
        return { ok: false, error: { code: "storage-unavailable" } };
      calls.push({ method: "assessReplacement", args: command.candidate });
      if (options.assessReplacement === undefined)
        throw new Error("assessReplacement must not be called before acquire");
      if (!options.assessReplacement.ok) {
        calls.push({
          method: "runMaintenance",
          args: { type: "abort", fence },
        });
        return options.assessReplacement as never;
      }
      const replacementCommand = {
        candidate: command.candidate,
        assessment: options.assessReplacement.value,
        fence,
      };
      calls.push({ method: "replaceRoot", args: replacementCommand });
      if (options.replaceRoot === undefined)
        throw new Error("replaceRoot must not be called before re-assessment");
      if (!options.replaceRoot.ok) {
        calls.push({
          method: "runMaintenance",
          args: { type: "abort", fence },
        });
        return options.replaceRoot as never;
      }
      calls.push({
        method: "runMaintenance",
        args: {
          type: "release",
          fence: { ...fence, revision: options.replaceRoot.value.revision },
        },
      });
      return {
        ok: true,
        value: {
          kind:
            options.releaseOrAbort?.ok === false
              ? "committed-finalization-required"
              : "committed",
          receipt: {
            mode: "normal",
            revision: options.replaceRoot.value.revision,
          },
          ...(options.releaseOrAbort?.ok === false
            ? { finalization: "fixture-finalization" as never }
            : {}),
        },
      } as never;
    },
    findPendingFinalization: notExpected("findPendingFinalization"),
    finalize: notExpected("finalize"),
  };
  return { data, calls };
};

test("commit成功時はacquire・再assess・replaceRoot・releaseの順で呼びpreview件数のsummaryを返す", async () => {
  const { data, calls } = foundationDataForCommit({
    acquire: { ok: true, value: { fence: FAKE_FENCE as never } },
    assessReplacement: { ok: true, value: FRESH_ASSESSMENT as never },
    replaceRoot: {
      ok: true,
      value: { revision: 5, beforeBytes: 1, afterBytes: 2 } as never,
    },
  });
  const service = createRestoreService({ data });

  const result = await service.commit(FAKE_TICKET as never);

  assert.equal(result.ok, true);
  if (result.ok)
    assert.deepEqual(result.value, {
      projectCount: 3,
      partCount: 5,
      currentBuildCount: 2,
    });
  assert.deepEqual(
    calls.map((call) => call.method),
    ["runMaintenance", "assessReplacement", "replaceRoot", "runMaintenance"],
  );
  const acquireCall = calls[0]?.args as { type: string; leaseMs: number };
  assert.equal(acquireCall.type, "acquire");
  assert.equal(acquireCall.leaseMs, 30_000);
  assert.deepEqual(calls[1]?.args, FAKE_TICKET.candidate);
  const releaseCall = calls[3]?.args as { type: string; fence: unknown };
  assert.equal(releaseCall.type, "release");
  // replaceRoot itself advances the revision, so release must carry the
  // fence forward with that new revision, not the acquire-time one.
  assert.deepEqual(releaseCall.fence, { ...FAKE_FENCE, revision: 5 });
  const replaceCall = calls[2]?.args as {
    fence: unknown;
    candidate: unknown;
    assessment: unknown;
  };
  assert.deepEqual(replaceCall.fence, FAKE_FENCE);
  assert.deepEqual(replaceCall.candidate, FAKE_TICKET.candidate);
  // Only the post-acquire assessment reaches replaceRoot. The preflight
  // assessment is used to build the preview and is not retained in the ticket.
  assert.deepEqual(replaceCall.assessment, FRESH_ASSESSMENT);
});

test("release cleanup失敗時も置換成功を保ちlease失効による回復を妨げない", async () => {
  const { data, calls } = foundationDataForCommit({
    acquire: { ok: true, value: { fence: FAKE_FENCE as never } },
    assessReplacement: { ok: true, value: FRESH_ASSESSMENT as never },
    replaceRoot: {
      ok: true,
      value: { revision: 5, beforeBytes: 1, afterBytes: 2 } as never,
    },
    releaseOrAbort: { ok: false, error: { code: "storage-unavailable" } },
  });

  const result = await createRestoreService({ data }).commit(
    FAKE_TICKET as never,
  );

  assert.equal(result.ok, true);
  const acquire = calls[0]?.args as { type: string; leaseMs: number };
  assert.equal(acquire.type, "acquire");
  assert.equal(acquire.leaseMs, 30_000);
  const cleanup = calls[3]?.args as { type: string };
  assert.equal(cleanup.type, "release");
});

test("acquireが保守競合で失敗した場合は再assessを呼ばず値を含まず拒否される", async () => {
  const { data, calls } = foundationDataForCommit({
    acquire: { ok: false, error: { code: "maintenance-active" } },
  });
  const service = createRestoreService({ data });

  const result = await service.commit(FAKE_TICKET as never);

  assert.equal(result.ok, false);
  if (!result.ok)
    assert.deepEqual(result.error, { code: "maintenance-active" });
  assert.deepEqual(
    calls.map((call) => call.method),
    ["runMaintenance"],
  );
});

test("acquire後の再assessが失敗した場合はabortして既存データを保持する", async () => {
  const { data, calls } = foundationDataForCommit({
    acquire: { ok: true, value: { fence: FAKE_FENCE as never } },
    assessReplacement: { ok: false, error: { code: "quota-exceeded" } },
  });
  const service = createRestoreService({ data });

  const result = await service.commit(FAKE_TICKET as never);

  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.error, { code: "quota-exceeded" });
  assert.deepEqual(
    calls.map((call) => call.method),
    ["runMaintenance", "assessReplacement", "runMaintenance"],
  );
  const abortCall = calls[2]?.args as { type: string; fence: unknown };
  assert.equal(abortCall.type, "abort");
  assert.deepEqual(abortCall.fence, FAKE_FENCE);
});

test("replaceRootがstale-assessmentで失敗した場合はabortして既存データを保持する", async () => {
  const { data, calls } = foundationDataForCommit({
    acquire: { ok: true, value: { fence: FAKE_FENCE as never } },
    assessReplacement: { ok: true, value: FRESH_ASSESSMENT as never },
    replaceRoot: { ok: false, error: { code: "stale-assessment" } },
  });
  const service = createRestoreService({ data });

  const result = await service.commit(FAKE_TICKET as never);

  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.error, { code: "stale-ticket" });
  const abortCall = calls[3]?.args as { type: string; fence: unknown };
  assert.equal(abortCall.type, "abort");
  assert.deepEqual(abortCall.fence, FAKE_FENCE);
});

test("replaceRootが容量超過で失敗した場合もabortして既存データを保持する", async () => {
  const { data, calls } = foundationDataForCommit({
    acquire: { ok: true, value: { fence: FAKE_FENCE as never } },
    assessReplacement: { ok: true, value: FRESH_ASSESSMENT as never },
    replaceRoot: { ok: false, error: { code: "quota-exceeded" } },
  });
  const service = createRestoreService({ data });

  const result = await service.commit(FAKE_TICKET as never);

  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.error, { code: "quota-exceeded" });
  const abortCall = calls[3]?.args as { type: string };
  assert.equal(abortCall.type, "abort");
});

test("replaceRootがowner外・期限切れ相当のstale-fenceで失敗した場合もabortして拒否される", async () => {
  const { data, calls } = foundationDataForCommit({
    acquire: { ok: true, value: { fence: FAKE_FENCE as never } },
    assessReplacement: { ok: true, value: FRESH_ASSESSMENT as never },
    replaceRoot: { ok: false, error: { code: "stale-fence" } },
  });
  const service = createRestoreService({ data });

  const result = await service.commit(FAKE_TICKET as never);

  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.error, { code: "stale-ticket" });
  const abortCall = calls[3]?.args as { type: string };
  assert.equal(abortCall.type, "abort");
});

test("復元セッションごとにUUID owner識別子でacquireする", async () => {
  const { data, calls } = foundationDataForCommit({
    acquire: { ok: true, value: { fence: FAKE_FENCE as never } },
    assessReplacement: { ok: true, value: FRESH_ASSESSMENT as never },
    replaceRoot: {
      ok: true,
      value: { revision: 5, beforeBytes: 1, afterBytes: 2 } as never,
    },
  });
  const service = createRestoreService({ data });

  await service.commit(FAKE_TICKET as never);

  const acquireCall = calls[0]?.args as { ownerId: string };
  assert.match(
    acquireCall.ownerId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
});
