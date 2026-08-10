import assert from "node:assert/strict";
import test from "node:test";
import type {
  RestoreContextLifecycle,
  RestorePostCommitCoordinator,
} from "../../../src/features/backup-restore/context-lifecycle.js";
import type {
  BackupArtifact,
  BackupError,
  FileError,
  RestoreError,
  RestoreInput,
  RestoreSummary,
  RestoreTicket,
} from "../../../src/features/backup-restore/contracts.js";
import type { FileGateway } from "../../../src/features/backup-restore/file-gateway.js";
import type {
  BackupService,
  RestoreService,
} from "../../../src/features/backup-restore/service.js";
import { createBackupRestoreState } from "../../../src/features/backup-restore/state.js";
import type { BackupRestoreFinalizationTicket } from "../../../src/persistence/public.js";

type Deferred<T> = {
  readonly promise: Promise<T>;
  resolve: (value: T) => void;
};

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const FAKE_ARTIFACT: BackupArtifact = {
  filename: "pc-build-planner-backup-2026-07-24.json",
  mimeType: "application/json",
  json: "{}",
  byteLength: 2,
};

const FAKE_TICKET: RestoreTicket = {
  candidate: { schemaVersion: 1 },
  mode: "normal",
  assessment: { id: "assessment-1" } as never,
  preview: {
    createdAt: "2026-07-24T00:00:00.000Z" as never,
    formatVersion: 1,
    projectCount: 1,
    partCount: 2,
    currentBuildCount: 1,
    estimatedBytes: 100,
  },
};

const FAKE_SUMMARY: RestoreSummary = {
  projectCount: 1,
  partCount: 2,
  currentBuildCount: 1,
};

const FINALIZATION = "finalization-1" as BackupRestoreFinalizationTicket;

const notExpected = (label: string) => (): never => {
  throw new Error(`must not call ${label}`);
};

const buildBackupService = (
  create: BackupService["create"],
): BackupService => ({
  create,
});

const buildRestoreService = (options: {
  preflight?: RestoreService["preflight"];
  reassess?: RestoreService["reassess"];
  commit?: RestoreService["commit"];
  findPendingFinalization?: RestoreService["findPendingFinalization"];
}): RestoreService => ({
  preflight: options.preflight ?? notExpected("preflight"),
  reassess: options.reassess ?? notExpected("reassess"),
  commit: options.commit ?? notExpected("commit"),
  findPendingFinalization:
    options.findPendingFinalization ??
    (async () => ({ ok: true, value: null })),
});

const buildFileGateway = (options: {
  read?: FileGateway["read"];
  download?: FileGateway["download"];
}): FileGateway => ({
  read: options.read ?? notExpected("read"),
  download: options.download ?? notExpected("download"),
});

interface LifecycleScript {
  prepare?: RestoreContextLifecycle["prepare"];
  confirm?: RestoreContextLifecycle["confirm"];
  cancel?: RestoreContextLifecycle["cancel"];
  begin?: RestoreContextLifecycle["begin"];
  complete?: RestoreContextLifecycle["complete"];
  isCommitAllowed?: RestoreContextLifecycle["isCommitAllowed"];
}

const buildLifecycle = (script: LifecycleScript, calls: string[]) => {
  let started = false;
  const lifecycle: RestoreContextLifecycle = {
    async prepare() {
      calls.push("prepare");
      started = false;
      return (
        script.prepare?.() ?? {
          ok: true,
          value: { kind: "permitted", permit: { id: "permit-1" } },
        }
      );
    },
    async confirm(confirmationId) {
      calls.push(`confirm:${confirmationId}`);
      return (
        script.confirm?.(confirmationId) ?? {
          ok: true,
          value: { id: "permit-1" },
        }
      );
    },
    cancel(confirmationId) {
      calls.push(`cancel:${confirmationId}`);
      return script.cancel?.(confirmationId) ?? { ok: true, value: undefined };
    },
    begin(permitId) {
      calls.push(`begin:${permitId}`);
      const result = script.begin?.(permitId) ?? {
        ok: true,
        value: undefined,
      };
      if (result.ok) started = true;
      return result;
    },
    async complete(permitId, outcome) {
      calls.push(`complete:${permitId}:${outcome}`);
      started = false;
      return (
        script.complete?.(permitId, outcome) ?? { ok: true, value: undefined }
      );
    },
    isCommitAllowed: (permitId) =>
      script.isCommitAllowed?.(permitId) ?? started,
    async refresh() {
      calls.push("refresh");
      return {
        ok: true,
        value: {
          status: "empty",
          generation: 1,
          catalog: [],
          selectedProjectId: null,
        },
      };
    },
  };
  return lifecycle;
};

const buildPostCommit = (
  calls: string[],
  options: {
    finalize?: RestorePostCommitCoordinator["finalizeOnly"];
    afterCommit?: RestorePostCommitCoordinator["afterCommit"];
  } = {},
): RestorePostCommitCoordinator => ({
  async afterCommit(input) {
    const { permitId, outcome } = input;
    calls.push(`afterCommit:${permitId}:${outcome.kind}`);
    if (options.afterCommit !== undefined) return options.afterCommit(input);
    if (outcome.kind === "committed-finalization-required")
      return {
        kind: "restored-finalization-required",
        summary: outcome.summary,
        finalization: outcome.finalization,
      };
    return { kind: "restored", summary: outcome.summary, context: "ready" };
  },
  finalizeOnly(ticket, summary) {
    calls.push("finalizeOnly");
    return (
      options.finalize?.(ticket, summary) ??
      Promise.resolve({
        ok: true,
        value: {
          kind: "restored",
          summary: summary ?? FAKE_SUMMARY,
          context: "ready",
        },
      })
    );
  },
  async refreshOnly(summary) {
    calls.push("refreshOnly");
    return { kind: "restored", summary, context: "ready" };
  },
});

const buildState = (options: {
  backup?: BackupService["create"];
  restore?: Parameters<typeof buildRestoreService>[0];
  file?: Parameters<typeof buildFileGateway>[0];
  lifecycle?: LifecycleScript;
  finalize?: RestorePostCommitCoordinator["finalizeOnly"];
  afterCommit?: RestorePostCommitCoordinator["afterCommit"];
}) => {
  const calls: string[] = [];
  const state = createBackupRestoreState({
    backupService: buildBackupService(options.backup ?? notExpected("create")),
    restoreService: buildRestoreService(options.restore ?? {}),
    fileGateway: buildFileGateway(options.file ?? {}),
    contextLifecycle: buildLifecycle(options.lifecycle ?? {}, calls),
    postCommit: buildPostCommit(calls, {
      ...(options.finalize === undefined ? {} : { finalize: options.finalize }),
      ...(options.afterCommit === undefined
        ? {}
        : { afterCommit: options.afterCommit }),
    }),
  });
  return { state, calls };
};

const FAKE_FILE = {} as File;
const FAKE_RESTORE_INPUT: RestoreInput = { text: "{}", byteLength: 2 };

const validated = async (options: Parameters<typeof buildState>[0] = {}) => {
  const built = buildState({
    ...options,
    restore: {
      preflight: async () => ({ ok: true, value: FAKE_TICKET }),
      ...options.restore,
    },
    file: {
      read: async () => ({ ok: true, value: FAKE_RESTORE_INPUT }),
      ...options.file,
    },
  });
  await built.state.validateFile(FAKE_FILE);
  return built;
};

test("初期状態はidleである", () => {
  const { state } = buildState({});
  assert.deepEqual(state.value, { phase: "idle" });
});

test("exportBackupはexporting経由でsucceededへ遷移しdownloadを呼ぶ", async () => {
  const downloads: BackupArtifact[] = [];
  const { state } = buildState({
    backup: async () => ({ ok: true, value: FAKE_ARTIFACT }),
    file: {
      download: (artifact) => {
        downloads.push(artifact);
        return { ok: true, value: undefined };
      },
    },
  });

  await state.exportBackup();

  assert.deepEqual(state.value, {
    phase: "succeeded",
    operation: "backup",
    filename: FAKE_ARTIFACT.filename,
  });
  assert.deepEqual(downloads, [FAKE_ARTIFACT]);
});

test("export失敗は再試行方針つきのfailedへ遷移する", async () => {
  const error: BackupError = { code: "storage" };
  const { state } = buildState({
    backup: async () => ({ ok: false, error }),
    file: { download: notExpected("download") },
  });

  await state.exportBackup();

  assert.deepEqual(state.value, {
    phase: "failed",
    operation: "backup",
    error,
    retry: { kind: "retryable", action: "retry-export" },
  });
});

test("自己復元不変条件違反のexportはunsupportedとして再試行を許可しない", async () => {
  const { state } = buildState({
    backup: async () => ({
      ok: false,
      error: { code: "backup-capacity-invariant" },
    }),
    file: { download: notExpected("download") },
  });

  await state.exportBackup();

  assert.deepEqual(
    state.value.phase === "failed" ? state.value.retry : undefined,
    { kind: "unsupported" },
  );
});

test("処理中のexportBackup重複呼び出しは抑止される", async () => {
  const gate = deferred<{ ok: true; value: BackupArtifact }>();
  let createCalls = 0;
  const { state } = buildState({
    backup: async () => {
      createCalls += 1;
      return gate.promise;
    },
    file: { download: () => ({ ok: true, value: undefined }) },
  });

  const first = state.exportBackup();
  const second = state.exportBackup();
  assert.equal(state.value.phase, "exporting");
  gate.resolve({ ok: true, value: FAKE_ARTIFACT });
  await Promise.all([first, second]);

  assert.equal(createCalls, 1);
  assert.equal(state.value.phase, "succeeded");
});

test("validateFileはawaiting-replacement-confirmationへ遷移しticketを保持する", async () => {
  const { state } = await validated();

  assert.deepEqual(state.value, {
    phase: "awaiting-replacement-confirmation",
    ticket: FAKE_TICKET,
  });
});

test("読取失敗は別file選択だけを許可するfailedへ遷移しpreflightを呼ばない", async () => {
  const error: FileError = { code: "unreadable" };
  const { state } = buildState({
    restore: { preflight: notExpected("preflight") },
    file: { read: async () => ({ ok: false, error }) },
  });

  await state.validateFile(FAKE_FILE);

  assert.deepEqual(state.value, {
    phase: "failed",
    operation: "restore",
    error,
    retry: { kind: "action-required", action: "select-another-file" },
  });
});

test("容量超過はunsupportedとしてticketを保持したまま同一入力の再実行を禁止する", async () => {
  const error: RestoreError = { code: "quota-exceeded" };
  const { state, calls } = await validated({
    restore: { commit: async () => ({ ok: false, error }) },
  });

  await state.confirmRestore();

  assert.deepEqual(state.value, {
    phase: "failed",
    operation: "restore",
    error,
    retry: { kind: "unsupported" },
    ticket: FAKE_TICKET,
  });

  const before = [...calls];
  await state.retryRestore();
  await state.reassessRestore();
  assert.deepEqual(calls, before);
});

test("確認取消はticketを保持したままawaiting状態からidleへ戻す", async () => {
  const { state } = await validated();

  state.cancel();

  assert.deepEqual(state.value, { phase: "idle" });
});

test("confirmRestoreはprepare→begin→commitの順で呼びbegin前にcommitしない", async () => {
  const commitOrder: string[] = [];
  const { state, calls } = await validated({
    restore: {
      commit: async () => {
        commitOrder.push("commit");
        return {
          ok: true,
          value: { kind: "committed", summary: FAKE_SUMMARY },
        };
      },
    },
  });

  await state.confirmRestore();

  assert.deepEqual(calls, [
    "prepare",
    "begin:permit-1",
    "afterCommit:permit-1:committed",
  ]);
  assert.deepEqual(commitOrder, ["commit"]);
  assert.deepEqual(state.value, {
    phase: "succeeded",
    operation: "restore",
    summary: FAKE_SUMMARY,
    context: "ready",
  });
});

test("draft確認が必要な場合はcommit前にawaiting-draft-confirmationで停止する", async () => {
  const { state, calls } = await validated({
    lifecycle: {
      async prepare() {
        return {
          ok: true,
          value: {
            kind: "confirmation-required",
            confirmation: { id: "confirm-1" },
          },
        };
      },
    },
    restore: {
      commit: async () => ({
        ok: true,
        value: { kind: "committed", summary: FAKE_SUMMARY },
      }),
    },
  });

  await state.confirmRestore();

  assert.deepEqual(state.value, {
    phase: "awaiting-draft-confirmation",
    ticket: FAKE_TICKET,
    confirmationId: "confirm-1",
  });
  assert.deepEqual(calls, ["prepare"]);

  await state.approveDraft();

  assert.deepEqual(calls, [
    "prepare",
    "confirm:confirm-1",
    "begin:permit-1",
    "afterCommit:permit-1:committed",
  ]);
  assert.equal(state.value.phase, "succeeded");
});

test("draft確認の取消はguardを閉じticketを保持したまま置換確認へ戻る", async () => {
  const { state, calls } = await validated({
    lifecycle: {
      async prepare() {
        return {
          ok: true,
          value: {
            kind: "confirmation-required",
            confirmation: { id: "confirm-1" },
          },
        };
      },
    },
    restore: { commit: notExpected("commit") },
  });

  await state.confirmRestore();
  state.cancelDraft();

  assert.deepEqual(state.value, {
    phase: "awaiting-replacement-confirmation",
    ticket: FAKE_TICKET,
  });
  assert.deepEqual(calls, ["prepare", "cancel:confirm-1"]);
});

test("guard拒否ではcommitせずresolve-draftをticket付きで要求する", async () => {
  const { state, calls } = await validated({
    lifecycle: {
      async prepare() {
        return { ok: false, error: { code: "guard-failed" } };
      },
    },
    restore: { commit: notExpected("commit") },
  });

  await state.confirmRestore();

  assert.deepEqual(state.value, {
    phase: "failed",
    operation: "restore",
    error: { code: "guard-failed" },
    retry: { kind: "action-required", action: "resolve-draft" },
    ticket: FAKE_TICKET,
  });
  assert.deepEqual(calls, ["prepare"]);
});

test("begin失敗ではcommitせずticketを保持して再試行できる", async () => {
  const { state, calls } = await validated({
    lifecycle: {
      begin: () => ({ ok: false, error: { code: "permit-stale" } }),
    },
    restore: { commit: notExpected("commit") },
  });

  await state.confirmRestore();

  assert.deepEqual(state.value, {
    phase: "failed",
    operation: "restore",
    error: { code: "permit-stale" },
    retry: { kind: "retryable", action: "retry-restore" },
    ticket: FAKE_TICKET,
  });
  assert.deepEqual(calls, ["prepare", "begin:permit-1"]);
});

test("commit前失敗ではfailedでpermitを閉じticketを保持する", async () => {
  const error: RestoreError = { code: "storage-unavailable" };
  const { state, calls } = await validated({
    restore: { commit: async () => ({ ok: false, error }) },
  });

  await state.confirmRestore();

  assert.deepEqual(state.value, {
    phase: "failed",
    operation: "restore",
    error,
    retry: { kind: "retryable", action: "retry-restore" },
    ticket: FAKE_TICKET,
  });
  assert.deepEqual(calls, [
    "prepare",
    "begin:permit-1",
    "complete:permit-1:failed",
  ]);
});

test("precommit-cleanup-pendingは同じticketと新しいpermitでのretryだけを許可する", async () => {
  let commits = 0;
  const { state, calls } = await validated({
    restore: {
      commit: async (ticket) => {
        commits += 1;
        assert.equal(ticket, FAKE_TICKET);
        return commits === 1
          ? { ok: false, error: { code: "precommit-cleanup-pending" } }
          : { ok: true, value: { kind: "committed", summary: FAKE_SUMMARY } };
      },
      reassess: notExpected("reassess"),
    },
  });

  await state.confirmRestore();
  assert.deepEqual(
    state.value.phase === "failed" ? state.value.retry : undefined,
    { kind: "retryable", action: "retry-restore" },
  );

  calls.length = 0;
  await state.retryRestore();

  assert.deepEqual(calls, [
    "prepare",
    "begin:permit-1",
    "afterCommit:permit-1:committed",
  ]);
  assert.equal(state.value.phase, "succeeded");
  assert.equal(commits, 2);
});

test("stale-assessmentは再assessmentだけを許可しcommit再送を禁止する", async () => {
  const nextTicket: RestoreTicket = {
    ...FAKE_TICKET,
    preview: { ...FAKE_TICKET.preview, projectCount: 7 },
  };
  const { state, calls } = await validated({
    restore: {
      commit: async () => ({ ok: false, error: { code: "stale-assessment" } }),
      reassess: async () => ({ ok: true, value: nextTicket }),
    },
  });

  await state.confirmRestore();
  assert.deepEqual(
    state.value.phase === "failed" ? state.value.retry : undefined,
    { kind: "retryable", action: "reassess-restore" },
  );

  calls.length = 0;
  await state.retryRestore();
  assert.deepEqual(calls, []);

  await state.reassessRestore();
  assert.deepEqual(state.value, {
    phase: "awaiting-replacement-confirmation",
    ticket: nextTicket,
  });
});

test("committed-finalization-requiredはfinalize-only状態を保持する", async () => {
  const { state } = await validated({
    restore: {
      commit: async () => ({
        ok: true,
        value: {
          kind: "committed-finalization-required",
          summary: FAKE_SUMMARY,
          finalization: FINALIZATION,
        },
      }),
    },
  });

  await state.confirmRestore();

  assert.deepEqual(state.value, {
    phase: "restored-finalization-required",
    summary: FAKE_SUMMARY,
    finalization: FINALIZATION,
  });
});

test("commit後はfile再選択と復元確定を公開しない", async () => {
  const { state, calls } = await validated({
    restore: {
      commit: async () => ({
        ok: true,
        value: {
          kind: "committed-finalization-required",
          summary: FAKE_SUMMARY,
          finalization: FINALIZATION,
        },
      }),
    },
  });

  await state.confirmRestore();
  calls.length = 0;
  await state.validateFile(FAKE_FILE);
  await state.confirmRestore();

  assert.deepEqual(calls, []);
  assert.equal(state.value.phase, "restored-finalization-required");
});

test("finalize-only retryはFoundation commitとguard lifecycleを再実行しない", async () => {
  const { state, calls } = await validated({
    restore: {
      commit: async () => ({
        ok: true,
        value: {
          kind: "committed-finalization-required",
          summary: FAKE_SUMMARY,
          finalization: FINALIZATION,
        },
      }),
    },
  });

  await state.confirmRestore();
  calls.length = 0;
  await state.finalizeRestore();

  assert.deepEqual(calls, ["finalizeOnly"]);
  assert.deepEqual(state.value, {
    phase: "succeeded",
    operation: "restore",
    summary: FAKE_SUMMARY,
    context: "ready",
  });
});

test("file再選択は未commit ticketを破棄し新しい検証結果へ差し替える", async () => {
  const second: RestoreTicket = {
    ...FAKE_TICKET,
    preview: { ...FAKE_TICKET.preview, projectCount: 9 },
  };
  let call = 0;
  const { state } = buildState({
    restore: {
      preflight: async () => {
        call += 1;
        return { ok: true, value: call === 1 ? FAKE_TICKET : second };
      },
    },
    file: { read: async () => ({ ok: true, value: FAKE_RESTORE_INPUT }) },
  });

  await state.validateFile(FAKE_FILE);
  await state.validateFile(FAKE_FILE);

  assert.deepEqual(state.value, {
    phase: "awaiting-replacement-confirmation",
    ticket: second,
  });
});

test("subscribeは状態変化時にlistenerを呼びunsubscribe後は呼ばない", async () => {
  const { state } = buildState({
    backup: async () => ({ ok: true, value: FAKE_ARTIFACT }),
    file: { download: () => ({ ok: true, value: undefined }) },
  });
  let notifications = 0;
  const unsubscribe = state.subscribe(() => {
    notifications += 1;
  });

  await state.exportBackup();
  assert.ok(notifications > 0);

  unsubscribe();
  const before = notifications;
  state.cancel();
  assert.equal(notifications, before);
});

test("resetForMountは未commit ticketを破棄し旧mountの結果を無視する", async () => {
  const gate = deferred<{ ok: true; value: BackupArtifact }>();
  let downloads = 0;
  const { state } = buildState({
    backup: async () => gate.promise,
    file: {
      download: () => {
        downloads += 1;
        return { ok: true, value: undefined };
      },
    },
  });

  const stale = state.exportBackup();
  state.resetForMount();
  gate.resolve({ ok: true, value: FAKE_ARTIFACT });
  await stale;

  assert.deepEqual(state.value, { phase: "idle" });
  assert.equal(downloads, 0);
});

test("resetForMountはrestoring中の結果を反映しない", async () => {
  const gate = deferred<{
    ok: true;
    value: { kind: "committed"; summary: RestoreSummary };
  }>();
  const { state } = await validated({
    restore: { commit: async () => gate.promise },
  });

  const stale = state.confirmRestore();
  state.resetForMount();
  gate.resolve({
    ok: true,
    value: { kind: "committed", summary: FAKE_SUMMARY },
  });
  await stale;

  assert.deepEqual(state.value, { phase: "idle" });
});

test("download失敗のexportは別file選択ではなく再exportを許可する", async () => {
  const { state } = buildState({
    backup: async () => ({ ok: true, value: FAKE_ARTIFACT }),
    file: { download: () => ({ ok: false, error: { code: "unreadable" } }) },
  });

  await state.exportBackup();

  assert.deepEqual(state.value, {
    phase: "failed",
    operation: "backup",
    error: { code: "unreadable" },
    retry: { kind: "retryable", action: "retry-export" },
  });
});

test("mount時のpending finalizationは通常idleより先にfinalize-only状態を再水和する", async () => {
  const { state, calls } = buildState({
    restore: {
      findPendingFinalization: async () => ({ ok: true, value: FINALIZATION }),
      commit: notExpected("commit"),
      preflight: notExpected("preflight"),
    },
  });

  state.resetForMount();
  assert.deepEqual(state.value, { phase: "idle" });
  await state.rehydratePendingFinalization();

  assert.deepEqual(state.value, {
    phase: "restored-finalization-required",
    finalization: FINALIZATION,
  });
  assert.deepEqual(calls, []);
});

test("pending finalizationが無ければmount後もidleのままである", async () => {
  const { state } = buildState({
    restore: {
      findPendingFinalization: async () => ({ ok: true, value: null }),
      commit: notExpected("commit"),
      preflight: notExpected("preflight"),
    },
  });

  state.resetForMount();
  await state.rehydratePendingFinalization();

  assert.deepEqual(state.value, { phase: "idle" });
});

test("pending finalization照会の失敗はidleを保ちfailedへ倒さない", async () => {
  const { state } = buildState({
    restore: {
      findPendingFinalization: async () => ({
        ok: false,
        error: { code: "storage-unavailable" },
      }),
      commit: notExpected("commit"),
      preflight: notExpected("preflight"),
    },
  });

  state.resetForMount();
  await state.rehydratePendingFinalization();

  assert.deepEqual(state.value, { phase: "idle" });
});

test("再水和したfinalize-onlyはsummary無しで実行しroot writeとguardを呼ばない", async () => {
  let observed: RestoreSummary | undefined | "unset" = "unset";
  const { state, calls } = buildState({
    restore: {
      findPendingFinalization: async () => ({ ok: true, value: FINALIZATION }),
      commit: notExpected("commit"),
      preflight: notExpected("preflight"),
    },
    finalize: async (_ticket, summary) => {
      observed = summary;
      return {
        ok: true,
        value: { kind: "restored", summary: FAKE_SUMMARY, context: "ready" },
      };
    },
  });

  state.resetForMount();
  await state.rehydratePendingFinalization();
  calls.length = 0;
  await state.finalizeRestore();

  assert.equal(observed, undefined);
  assert.deepEqual(calls, ["finalizeOnly"]);
  assert.deepEqual(state.value, {
    phase: "succeeded",
    operation: "restore",
    summary: FAKE_SUMMARY,
    context: "ready",
  });
});

test("再水和したfinalize-onlyの失敗はsummary無しの同じ状態へ戻る", async () => {
  const { state } = buildState({
    restore: {
      findPendingFinalization: async () => ({ ok: true, value: FINALIZATION }),
      commit: notExpected("commit"),
      preflight: notExpected("preflight"),
    },
    finalize: async () => ({
      ok: false,
      error: { code: "maintenance-active" },
    }),
  });

  state.resetForMount();
  await state.rehydratePendingFinalization();
  await state.finalizeRestore();

  assert.deepEqual(state.value, {
    phase: "restored-finalization-required",
    finalization: FINALIZATION,
  });
});

test("commit後は復元retryとreassessを公開しない", async () => {
  const { state, calls } = await validated({
    restore: {
      commit: async () => ({
        ok: true,
        value: {
          kind: "committed-finalization-required",
          summary: FAKE_SUMMARY,
          finalization: FINALIZATION,
        },
      }),
      reassess: notExpected("reassess"),
    },
  });

  await state.confirmRestore();
  calls.length = 0;
  await state.retryRestore();
  await state.reassessRestore();
  state.cancel();

  assert.deepEqual(calls, []);
  assert.deepEqual(state.value, {
    phase: "restored-finalization-required",
    summary: FAKE_SUMMARY,
    finalization: FINALIZATION,
  });
});

test("refresh-only retryはroot writeとguard lifecycleを0回で完了する", async () => {
  const { state, calls } = await validated({
    restore: {
      commit: async () => ({
        ok: true,
        value: { kind: "committed", summary: FAKE_SUMMARY },
      }),
    },
    afterCommit: async ({ outcome }) => ({
      kind: "restored-context-unavailable",
      summary: outcome.summary,
    }),
  });

  await state.confirmRestore();
  assert.deepEqual(state.value, {
    phase: "restored-context-unavailable",
    summary: FAKE_SUMMARY,
  });

  calls.length = 0;
  await state.refreshContext();

  assert.deepEqual(calls, ["refreshOnly"]);
  assert.deepEqual(state.value, {
    phase: "succeeded",
    operation: "restore",
    summary: FAKE_SUMMARY,
    context: "ready",
  });
});

test("permitがbegin後に開いていなければcommitへ進まない", async () => {
  const { state, calls } = await validated({
    lifecycle: { isCommitAllowed: () => false },
    restore: { commit: notExpected("commit") },
  });

  await state.confirmRestore();

  assert.deepEqual(state.value, {
    phase: "failed",
    operation: "restore",
    error: { code: "permit-stale" },
    retry: { kind: "retryable", action: "retry-restore" },
    ticket: FAKE_TICKET,
  });
  assert.deepEqual(calls, ["prepare", "begin:permit-1"]);
});
