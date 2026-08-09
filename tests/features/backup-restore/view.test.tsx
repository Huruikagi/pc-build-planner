import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { act } from "react";
import { createRoot } from "react-dom/client";

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
}) =>
  createBackupRestoreState({
    ...unattachedContextDependencies(),
    backupService: { create: options.create ?? notExpected("create") },
    restoreService: {
      preflight: options.preflight ?? notExpected("preflight"),
      commit: options.commit ?? notExpected("commit"),
    },
    fileGateway: {
      read: options.read ?? notExpected("read"),
      download: options.download ?? notExpected("download"),
    },
  });

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
