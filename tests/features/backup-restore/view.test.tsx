import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { act } from "react";
import { createRoot } from "react-dom/client";

import type { RestoreContextLifecycle } from "../../../src/features/backup-restore/context-lifecycle.js";
import type {
  BackupArtifact,
  RestoreTicket,
} from "../../../src/features/backup-restore/contracts.js";
import type { FileGateway } from "../../../src/features/backup-restore/file-gateway.js";
import type {
  BackupService,
  RestoreService,
} from "../../../src/features/backup-restore/service.js";
import { createBackupRestoreState } from "../../../src/features/backup-restore/state.js";
import { BackupRestoreView } from "../../../src/features/backup-restore/view.js";
import { defaultMessageResolver } from "../../../src/ui-messages/public.js";
import { unattachedContextDependencies } from "./state-context-harness.js";

const FAKE_ARTIFACT: BackupArtifact = {
  filename: "<img src=x onerror=alert(1)>-backup.json",
  mimeType: "application/json",
  json: "{}",
  byteLength: 2,
};

const FAKE_TICKET: RestoreTicket = {
  candidate: { schemaVersion: 1 },
  preview: {
    createdAt: "2026-07-24T00:00:00.000Z" as never,
    formatVersion: 1,
    projectCount: 3,
    partCount: 5,
    currentBuildCount: 2,
    estimatedBytes: 100,
  },
};

const notExpected = (label: string) => (): never => {
  throw new Error(`must not call ${label}`);
};

const buildState = (options: {
  create?: BackupService["create"];
  download?: FileGateway["download"];
  read?: FileGateway["read"];
  preflight?: RestoreService["preflight"];
  commit?: RestoreService["commit"];
  findPendingFinalization?: RestoreService["findPendingFinalization"];
  guardPrepare?: RestoreContextLifecycle["prepare"];
}) => {
  const context = unattachedContextDependencies();
  const contextLifecycle: RestoreContextLifecycle =
    options.guardPrepare === undefined
      ? context.contextLifecycle
      : { ...context.contextLifecycle, prepare: options.guardPrepare };
  return createBackupRestoreState({
    ...context,
    contextLifecycle,
    backupService: { create: options.create ?? notExpected("create") },
    restoreService: {
      preflight: options.preflight ?? notExpected("preflight"),
      commit: options.commit ?? notExpected("commit"),
      ...(options.findPendingFinalization === undefined
        ? {}
        : { findPendingFinalization: options.findPendingFinalization }),
    },
    fileGateway: {
      read: options.read ?? notExpected("read"),
      download: options.download ?? notExpected("download"),
    },
  });
};

async function renderView(state: ReturnType<typeof buildState>) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(() => root.render(<BackupRestoreView state={state} />));
  return {
    container,
    cleanup: async () => {
      await act(() => root.unmount());
      container.remove();
    },
  };
}

const fakeFileList = (file: File): FileList => {
  const list: Record<PropertyKey, unknown> = {
    0: file,
    length: 1,
    item: (index: number) => (index === 0 ? file : null),
    [Symbol.iterator]: function* () {
      yield file;
    },
  };
  return list as unknown as FileList;
};

const selectFile = async (input: HTMLInputElement, file: File) => {
  Object.defineProperty(input, "files", {
    value: fakeFileList(file),
    configurable: true,
  });
  await act(async () => {
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
};

test("バックアップと復元を分離し消失リスク・保管責任・自動同期なしを表示する", async () => {
  const state = buildState({});
  const rendered = await renderView(state);

  const text = rendered.container.textContent ?? "";
  assert.match(
    text,
    new RegExp(defaultMessageResolver("backup.exportHeading")),
  );
  assert.match(
    text,
    new RegExp(defaultMessageResolver("backup.restoreHeading")),
  );
  assert.match(
    text,
    new RegExp(defaultMessageResolver("backup.noticeUninstall")),
  );
  assert.match(
    text,
    new RegExp(defaultMessageResolver("backup.noticeFileOwnership")),
  );
  assert.match(
    text,
    new RegExp(defaultMessageResolver("backup.noticeNoAutoBackup")),
  );

  await rendered.cleanup();
});

test("設定区画へ埋め込む操作見出しを区画見出しより一段下げる", async () => {
  const state = buildState({});
  const rendered = await renderView(state);

  for (const region of ["export", "restore"] as const) {
    const section = rendered.container.querySelector<HTMLElement>(
      `[data-region="${region}"]`,
    );
    assert.ok(section);
    assert.ok(section.querySelector("h4"));
    assert.equal(section.querySelector("h3"), null);
  }

  await rendered.cleanup();
});

test("バックアップ作成ボタンでexportBackupを呼び成功時にファイル名を表示する", async () => {
  const downloadCalls: BackupArtifact[] = [];
  const state = buildState({
    create: async () => ({ ok: true, value: FAKE_ARTIFACT }),
    download: (artifact) => {
      downloadCalls.push(artifact);
      return { ok: true, value: undefined };
    },
  });
  const rendered = await renderView(state);
  const button = rendered.container.querySelector(
    'button[data-action="export"]',
  ) as HTMLButtonElement;
  assert.ok(button);

  await act(async () => button.click());

  assert.equal(downloadCalls.length, 1);
  assert.match(rendered.container.textContent ?? "", /backup\.json/);

  await rendered.cleanup();
});

test("バックアップ失敗時は分類済みメッセージを表示し原文を出さない", async () => {
  const state = buildState({
    create: async () => ({ ok: false, error: { code: "storage" } }),
  });
  const rendered = await renderView(state);
  const button = rendered.container.querySelector(
    'button[data-action="export"]',
  ) as HTMLButtonElement;

  await act(async () => button.click());

  const alert = rendered.container.querySelector('[role="alert"]');
  assert.ok(alert);
  assert.doesNotMatch(alert?.textContent ?? "", /^\{.*\}$/);

  await rendered.cleanup();
});

test("ファイル選択でvalidateFileを呼びawaiting-confirmationでpreviewと確認操作を表示する", async () => {
  const state = buildState({
    preflight: async () => ({ ok: true, value: FAKE_TICKET }),
    read: async () => ({ ok: true, value: { text: "{}", byteLength: 2 } }),
  });
  const rendered = await renderView(state);
  const input = rendered.container.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  assert.ok(input);
  assert.equal(input.hasAttribute("multiple"), false);

  const file = new File(["{}"], "restore.json", { type: "application/json" });
  await selectFile(input, file);

  const text = rendered.container.textContent ?? "";
  assert.match(text, /3/);
  assert.match(text, /5/);
  assert.match(text, /2/);
  assert.match(text, /2026-07-24/);
  assert.ok(rendered.container.querySelector('button[data-action="confirm"]'));
  assert.ok(rendered.container.querySelector('button[data-action="cancel"]'));

  await rendered.cleanup();
});

test("確認ボタンはawaiting-confirmation以外では描画されない", async () => {
  const state = buildState({});
  const rendered = await renderView(state);

  assert.equal(
    rendered.container.querySelector('button[data-action="confirm"]'),
    null,
  );

  await rendered.cleanup();
});

test("確認確定でconfirmRestoreを呼び成功summaryを表示する", async () => {
  const state = buildState({
    preflight: async () => ({ ok: true, value: FAKE_TICKET }),
    read: async () => ({ ok: true, value: { text: "{}", byteLength: 2 } }),
    commit: async () => ({
      ok: true,
      value: { projectCount: 3, partCount: 5, currentBuildCount: 2 },
    }),
  });
  const rendered = await renderView(state);
  const input = rendered.container.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  const file = new File(["{}"], "restore.json", { type: "application/json" });
  await selectFile(input, file);

  const confirmButton = rendered.container.querySelector(
    'button[data-action="confirm"]',
  ) as HTMLButtonElement;
  await act(async () => confirmButton.click());

  const text = rendered.container.textContent ?? "";
  assert.match(
    text,
    new RegExp(
      defaultMessageResolver("backup.restoreCompleted", {
        projectCount: 3,
        partCount: 5,
        currentBuildCount: 2,
      }),
    ),
  );
  assert.equal(
    rendered.container.querySelector('button[data-action="confirm"]'),
    null,
  );

  await rendered.cleanup();
});

test("取消でcancelを呼びawaiting-confirmationからidleへ戻る", async () => {
  const state = buildState({
    preflight: async () => ({ ok: true, value: FAKE_TICKET }),
    read: async () => ({ ok: true, value: { text: "{}", byteLength: 2 } }),
  });
  const rendered = await renderView(state);
  const input = rendered.container.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  const file = new File(["{}"], "restore.json", { type: "application/json" });
  await selectFile(input, file);
  assert.ok(rendered.container.querySelector('button[data-action="cancel"]'));

  const cancelButton = rendered.container.querySelector(
    'button[data-action="cancel"]',
  ) as HTMLButtonElement;
  await act(async () => cancelButton.click());

  assert.equal(state.value.phase, "idle");
  assert.equal(
    rendered.container.querySelector('button[data-action="confirm"]'),
    null,
  );

  await rendered.cleanup();
});

test("処理中はエクスポートボタンとファイル入力が無効になる", async () => {
  let resolveCreate: (value: { ok: true; value: BackupArtifact }) => void =
    () => {};
  const state = buildState({
    create: () =>
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    download: () => ({ ok: true, value: undefined }),
  });
  const rendered = await renderView(state);
  const exportButton = rendered.container.querySelector(
    'button[data-action="export"]',
  ) as HTMLButtonElement;
  const input = rendered.container.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;

  let pending: Promise<void> = Promise.resolve();
  act(() => {
    pending = state.exportBackup();
  });
  assert.equal(exportButton.disabled, true);
  assert.equal(input.disabled, true);

  resolveCreate({ ok: true, value: FAKE_ARTIFACT });
  await act(async () => pending);

  await rendered.cleanup();
});

test("dangerouslySetInnerHTML・innerHTMLを使わずファイル名を安全に描画する", async () => {
  const viewSourcePath = fileURLToPath(
    new URL("../../../src/features/backup-restore/view.tsx", import.meta.url),
  );
  const source = readFileSync(viewSourcePath, "utf8");
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(source, /\.innerHTML\s*=/);

  const state = buildState({
    create: async () => ({ ok: true, value: FAKE_ARTIFACT }),
    download: () => ({ ok: true, value: undefined }),
  });
  const rendered = await renderView(state);
  const button = rendered.container.querySelector(
    'button[data-action="export"]',
  ) as HTMLButtonElement;
  await act(async () => button.click());

  assert.equal(rendered.container.querySelector("img"), null);
  assert.match(rendered.container.innerHTML, /&lt;img/);

  await rendered.cleanup();
});

const RECOVERY_TICKET: RestoreTicket = {
  ...FAKE_TICKET,
  mode: "recovery",
  currentAnomaly: { code: "corrupt-data" },
};

test("回復modeのpreviewは現在データの異常を固定文言で案内する", async () => {
  const state = buildState({
    preflight: async () => ({ ok: true, value: RECOVERY_TICKET }),
    read: async () => ({ ok: true, value: { text: "{}", byteLength: 2 } }),
  });
  const rendered = await renderView(state);
  const input = rendered.container.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  await selectFile(
    input,
    new File(["{}"], "restore.json", { type: "application/json" }),
  );

  const recovery = rendered.container.querySelector(
    '[data-region="restore-recovery"]',
  );
  assert.ok(recovery);
  assert.match(
    recovery.textContent ?? "",
    new RegExp(defaultMessageResolver("backup.recoveryModeCorrupt")),
  );
  assert.ok(rendered.container.querySelector('button[data-action="confirm"]'));

  await rendered.cleanup();
});

test("未対応の現行データではunsupported向けの回復案内を表示する", async () => {
  const state = buildState({
    preflight: async () => ({
      ok: true,
      value: {
        ...FAKE_TICKET,
        mode: "recovery",
        currentAnomaly: { code: "unsupported-version" },
      },
    }),
    read: async () => ({ ok: true, value: { text: "{}", byteLength: 2 } }),
  });
  const rendered = await renderView(state);
  const input = rendered.container.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  await selectFile(
    input,
    new File(["{}"], "restore.json", { type: "application/json" }),
  );

  assert.match(
    rendered.container.textContent ?? "",
    new RegExp(defaultMessageResolver("backup.recoveryModeUnsupported")),
  );

  await rendered.cleanup();
});

test("失敗表示は分類済み文言に加えて再試行方針を示す", async () => {
  const state = buildState({
    preflight: async () => ({
      ok: false,
      error: { code: "invalid-structure", path: "$.projects[0].name" },
    }),
    read: async () => ({ ok: true, value: { text: "{}", byteLength: 2 } }),
  });
  const rendered = await renderView(state);
  const input = rendered.container.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  await selectFile(
    input,
    new File(["{}"], "restore.json", { type: "application/json" }),
  );

  const guidance = rendered.container.querySelector(
    '[data-region="restore-retry-guidance"]',
  );
  assert.ok(guidance);
  assert.match(
    guidance.textContent ?? "",
    new RegExp(
      defaultMessageResolver("backup.retryGuidance.select-another-file"),
    ),
  );
  /** 検証pathは内部結果に留め、DOMへ出さない。 */
  assert.doesNotMatch(rendered.container.textContent ?? "", /projects\[0\]/);

  await rendered.cleanup();
});

test("未保存draft拒否では解消後の再試行操作と案内を提供する", async () => {
  const state = buildState({
    preflight: async () => ({ ok: true, value: FAKE_TICKET }),
    read: async () => ({ ok: true, value: { text: "{}", byteLength: 2 } }),
    guardPrepare: async () => ({ ok: false, error: { code: "guard-failed" } }),
  });
  const rendered = await renderView(state);
  const input = rendered.container.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  await selectFile(
    input,
    new File(["{}"], "restore.json", { type: "application/json" }),
  );
  const confirmButton = rendered.container.querySelector(
    'button[data-action="confirm"]',
  ) as HTMLButtonElement;
  await act(async () => confirmButton.click());

  assert.match(
    rendered.container.textContent ?? "",
    new RegExp(defaultMessageResolver("backup.retryGuidance.resolve-draft")),
  );
  assert.ok(
    rendered.container.querySelector('button[data-action="retry-restore"]'),
  );

  await rendered.cleanup();
});

test("同一入力を再実行できない失敗では再試行操作を描画しない", async () => {
  const state = buildState({
    preflight: async () => ({
      ok: false,
      error: { code: "unsupported-version", path: "$.formatVersion" },
    }),
    read: async () => ({ ok: true, value: { text: "{}", byteLength: 2 } }),
  });
  const rendered = await renderView(state);
  const input = rendered.container.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  await selectFile(
    input,
    new File(["{}"], "restore.json", { type: "application/json" }),
  );

  assert.match(
    rendered.container.textContent ?? "",
    new RegExp(defaultMessageResolver("backup.retryGuidance.unsupported")),
  );
  assert.equal(
    rendered.container.querySelector('button[data-action="retry-restore"]'),
    null,
  );
  assert.equal(
    rendered.container.querySelector('button[data-action="reassess-restore"]'),
    null,
  );

  await rendered.cleanup();
});

test("再水和したfinalize-onlyはsummary無しでも後処理操作だけを提供する", async () => {
  const state = buildState({
    findPendingFinalization: async () => ({
      ok: true,
      value: "finalization-1" as never,
    }),
  });
  state.resetForMount();
  await state.rehydratePendingFinalization();
  const rendered = await renderView(state);

  assert.ok(
    rendered.container.querySelector('[data-region="restore-finalization"]'),
  );
  assert.ok(rendered.container.querySelector('button[data-action="finalize"]'));
  assert.equal(
    rendered.container
      .querySelector('input[type="file"]')
      ?.hasAttribute("disabled"),
    true,
  );
  assert.doesNotMatch(rendered.container.textContent ?? "", /プロジェクト1件/);

  await rendered.cleanup();
});
