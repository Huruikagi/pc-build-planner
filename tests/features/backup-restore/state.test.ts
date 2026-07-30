import assert from "node:assert/strict";
import test from "node:test";

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
  assessment: { requiredBytes: 100 } as never,
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

const notExpected = (label: string) => (): never => {
  throw new Error(`must not call ${label}`);
};

const buildBackupService = (
  create: BackupService["create"],
): BackupService => ({ create });

const buildRestoreService = (options: {
  preflight?: RestoreService["preflight"];
  commit?: RestoreService["commit"];
}): RestoreService => ({
  preflight: options.preflight ?? notExpected("preflight"),
  commit: options.commit ?? notExpected("commit"),
});

const buildFileGateway = (options: {
  read?: FileGateway["read"];
  download?: FileGateway["download"];
}): FileGateway => ({
  read: options.read ?? notExpected("read"),
  download: options.download ?? notExpected("download"),
});

const FAKE_FILE = {} as File;
const FAKE_RESTORE_INPUT: RestoreInput = { text: "{}", byteLength: 2 };

test("初期状態はidleである", () => {
  const state = createBackupRestoreState({
    backupService: buildBackupService(notExpected("create")),
    restoreService: buildRestoreService({}),
    fileGateway: buildFileGateway({}),
  });

  assert.deepEqual(state.value, { phase: "idle" });
});

test("exportBackupはexporting経由でsucceededへ遷移しdownloadを呼ぶ", async () => {
  const downloadCalls: BackupArtifact[] = [];
  const state = createBackupRestoreState({
    backupService: buildBackupService(async () => ({
      ok: true,
      value: FAKE_ARTIFACT,
    })),
    restoreService: buildRestoreService({}),
    fileGateway: buildFileGateway({
      download: (artifact) => {
        downloadCalls.push(artifact);
        return { ok: true, value: undefined };
      },
    }),
  });

  await state.exportBackup();

  assert.deepEqual(state.value, {
    phase: "succeeded",
    operation: "backup",
    filename: FAKE_ARTIFACT.filename,
  });
  assert.deepEqual(downloadCalls, [FAKE_ARTIFACT]);
});

test("exportBackupはartifact生成失敗時にfailedへ遷移しdownloadを呼ばない", async () => {
  const error: BackupError = { code: "corrupt-current-data" };
  const state = createBackupRestoreState({
    backupService: buildBackupService(async () => ({ ok: false, error })),
    restoreService: buildRestoreService({}),
    fileGateway: buildFileGateway({ download: notExpected("download") }),
  });

  await state.exportBackup();

  assert.deepEqual(state.value, {
    phase: "failed",
    operation: "backup",
    error,
  });
});

test("exportBackupはdownload失敗時にfailedへ遷移する", async () => {
  const error: FileError = { code: "unreadable" };
  const state = createBackupRestoreState({
    backupService: buildBackupService(async () => ({
      ok: true,
      value: FAKE_ARTIFACT,
    })),
    restoreService: buildRestoreService({}),
    fileGateway: buildFileGateway({ download: () => ({ ok: false, error }) }),
  });

  await state.exportBackup();

  assert.deepEqual(state.value, {
    phase: "failed",
    operation: "backup",
    error,
  });
});

test("処理中のexportBackup重複呼び出しは抑止される", async () => {
  const gate = deferred<{ ok: true; value: BackupArtifact }>();
  let createCalls = 0;
  const state = createBackupRestoreState({
    backupService: buildBackupService(async () => {
      createCalls += 1;
      return gate.promise;
    }),
    restoreService: buildRestoreService({}),
    fileGateway: buildFileGateway({
      download: () => ({ ok: true, value: undefined }),
    }),
  });

  const first = state.exportBackup();
  const second = state.exportBackup();
  assert.equal(state.value.phase, "exporting");
  gate.resolve({ ok: true, value: FAKE_ARTIFACT });
  await Promise.all([first, second]);

  assert.equal(createCalls, 1);
  assert.equal(state.value.phase, "succeeded");
});

test("validateFileはvalidating経由でawaiting-confirmationへ遷移しticketを保持する", async () => {
  const state = createBackupRestoreState({
    backupService: buildBackupService(notExpected("create")),
    restoreService: buildRestoreService({
      preflight: async () => ({ ok: true, value: FAKE_TICKET }),
    }),
    fileGateway: buildFileGateway({
      read: async () => ({ ok: true, value: FAKE_RESTORE_INPUT }),
    }),
  });

  await state.validateFile(FAKE_FILE);

  assert.deepEqual(state.value, {
    phase: "awaiting-confirmation",
    ticket: FAKE_TICKET,
  });
});

test("validateFileは読取失敗時にfailedへ遷移しpreflightを呼ばない", async () => {
  const error: FileError = { code: "size-exceeded" };
  const state = createBackupRestoreState({
    backupService: buildBackupService(notExpected("create")),
    restoreService: buildRestoreService({
      preflight: notExpected("preflight"),
    }),
    fileGateway: buildFileGateway({ read: async () => ({ ok: false, error }) }),
  });

  await state.validateFile(FAKE_FILE);

  assert.deepEqual(state.value, {
    phase: "failed",
    operation: "restore",
    error,
  });
});

test("validateFileはpreflight失敗時にfailedへ遷移する", async () => {
  const error: RestoreError = { code: "invalid-structure", path: "$.data" };
  const state = createBackupRestoreState({
    backupService: buildBackupService(notExpected("create")),
    restoreService: buildRestoreService({
      preflight: async () => ({ ok: false, error }),
    }),
    fileGateway: buildFileGateway({
      read: async () => ({ ok: true, value: FAKE_RESTORE_INPUT }),
    }),
  });

  await state.validateFile(FAKE_FILE);

  assert.deepEqual(state.value, {
    phase: "failed",
    operation: "restore",
    error,
  });
});

test("awaiting-confirmation中の再選択は既存ticketを破棄し新しいticketへ差し替える", async () => {
  const secondTicket: RestoreTicket = {
    ...FAKE_TICKET,
    preview: { ...FAKE_TICKET.preview, projectCount: 9 },
  };
  let call = 0;
  const state = createBackupRestoreState({
    backupService: buildBackupService(notExpected("create")),
    restoreService: buildRestoreService({
      preflight: async () => {
        call += 1;
        return { ok: true, value: call === 1 ? FAKE_TICKET : secondTicket };
      },
    }),
    fileGateway: buildFileGateway({
      read: async () => ({ ok: true, value: FAKE_RESTORE_INPUT }),
    }),
  });

  await state.validateFile(FAKE_FILE);
  assert.equal(
    state.value.phase === "awaiting-confirmation"
      ? state.value.ticket.preview.projectCount
      : undefined,
    1,
  );

  await state.validateFile(FAKE_FILE);
  assert.equal(
    state.value.phase === "awaiting-confirmation"
      ? state.value.ticket.preview.projectCount
      : undefined,
    9,
  );
});

test("confirmRestoreはawaiting-confirmation以外からは呼べない", async () => {
  const state = createBackupRestoreState({
    backupService: buildBackupService(notExpected("create")),
    restoreService: buildRestoreService({ commit: notExpected("commit") }),
    fileGateway: buildFileGateway({}),
  });

  await state.confirmRestore();

  assert.deepEqual(state.value, { phase: "idle" });
});

test("confirmRestoreはrestoring経由でsucceededへ遷移しsummaryを保持する", async () => {
  const state = createBackupRestoreState({
    backupService: buildBackupService(notExpected("create")),
    restoreService: buildRestoreService({
      preflight: async () => ({ ok: true, value: FAKE_TICKET }),
      commit: async () => ({ ok: true, value: FAKE_SUMMARY }),
    }),
    fileGateway: buildFileGateway({
      read: async () => ({ ok: true, value: FAKE_RESTORE_INPUT }),
    }),
  });

  await state.validateFile(FAKE_FILE);
  await state.confirmRestore();

  assert.deepEqual(state.value, {
    phase: "succeeded",
    operation: "restore",
    summary: FAKE_SUMMARY,
  });
});

test("confirmRestoreの失敗はfailedへ遷移する", async () => {
  const error: RestoreError = { code: "stale-ticket" };
  const state = createBackupRestoreState({
    backupService: buildBackupService(notExpected("create")),
    restoreService: buildRestoreService({
      preflight: async () => ({ ok: true, value: FAKE_TICKET }),
      commit: async () => ({ ok: false, error }),
    }),
    fileGateway: buildFileGateway({
      read: async () => ({ ok: true, value: FAKE_RESTORE_INPUT }),
    }),
  });

  await state.validateFile(FAKE_FILE);
  await state.confirmRestore();

  assert.deepEqual(state.value, {
    phase: "failed",
    operation: "restore",
    error,
  });
});

test("cancelはawaiting-confirmationからidleへ戻しticketを破棄する", async () => {
  const state = createBackupRestoreState({
    backupService: buildBackupService(notExpected("create")),
    restoreService: buildRestoreService({
      preflight: async () => ({ ok: true, value: FAKE_TICKET }),
    }),
    fileGateway: buildFileGateway({
      read: async () => ({ ok: true, value: FAKE_RESTORE_INPUT }),
    }),
  });

  await state.validateFile(FAKE_FILE);
  state.cancel();

  assert.deepEqual(state.value, { phase: "idle" });
});

test("cancelはfailed・succeededからもidleへ戻る", async () => {
  const state = createBackupRestoreState({
    backupService: buildBackupService(async () => ({
      ok: false,
      error: { code: "storage" },
    })),
    restoreService: buildRestoreService({}),
    fileGateway: buildFileGateway({}),
  });

  await state.exportBackup();
  assert.equal(state.value.phase, "failed");
  state.cancel();
  assert.deepEqual(state.value, { phase: "idle" });
});

test("処理中はcancelを受け付けず表示を維持する", async () => {
  const gate = deferred<{ ok: true; value: BackupArtifact }>();
  const state = createBackupRestoreState({
    backupService: buildBackupService(async () => gate.promise),
    restoreService: buildRestoreService({}),
    fileGateway: buildFileGateway({
      download: () => ({ ok: true, value: undefined }),
    }),
  });

  const pending = state.exportBackup();
  state.cancel();
  assert.equal(state.value.phase, "exporting");
  gate.resolve({ ok: true, value: FAKE_ARTIFACT });
  await pending;
});

test("subscribeは状態変化時にlistenerを呼びunsubscribe後は呼ばない", async () => {
  const state = createBackupRestoreState({
    backupService: buildBackupService(async () => ({
      ok: true,
      value: FAKE_ARTIFACT,
    })),
    restoreService: buildRestoreService({}),
    fileGateway: buildFileGateway({
      download: () => ({ ok: true, value: undefined }),
    }),
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

test("resetForMountはexportingをidle化し旧backup完了を無視する", async () => {
  const gate = deferred<{ ok: true; value: BackupArtifact }>();
  let downloads = 0;
  const state = createBackupRestoreState({
    backupService: buildBackupService(async () => gate.promise),
    restoreService: buildRestoreService({}),
    fileGateway: buildFileGateway({
      download: () => {
        downloads += 1;
        return { ok: true, value: undefined };
      },
    }),
  });
  const stale = state.exportBackup();
  state.resetForMount();
  gate.resolve({ ok: true, value: FAKE_ARTIFACT });
  await stale;
  assert.deepEqual(state.value, { phase: "idle" });
  assert.equal(downloads, 0);
});

test("resetForMountはrestoringをidle化し旧commit完了を無視する", async () => {
  const gate = deferred<{ ok: true; value: RestoreSummary }>();
  const state = createBackupRestoreState({
    backupService: buildBackupService(notExpected("create")),
    restoreService: buildRestoreService({
      preflight: async () => ({ ok: true, value: FAKE_TICKET }),
      commit: async () => gate.promise,
    }),
    fileGateway: buildFileGateway({
      read: async () => ({ ok: true, value: FAKE_RESTORE_INPUT }),
    }),
  });
  await state.validateFile(FAKE_FILE);
  const stale = state.confirmRestore();
  state.resetForMount();
  gate.resolve({ ok: true, value: FAKE_SUMMARY });
  await stale;
  assert.deepEqual(state.value, { phase: "idle" });
});
