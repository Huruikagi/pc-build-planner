import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";

import type { FeatureMountHandle } from "../../../src/application-shell/public.js";
import {
  type BackupRestoreSectionMount,
  createBackupRestoreSectionMount,
} from "../../../src/features/backup-restore/public.js";
import { createBackupRestoreState } from "../../../src/features/backup-restore/state.js";
import type { FoundationDataPort } from "../../../src/persistence/public.js";

const notExpected = (label: string) => (): never => {
  throw new Error(`must not call ${label}`);
};

const data: FoundationDataPort = {
  query: notExpected("query"),
  mutate: notExpected("mutate"),
  assessReplacement: notExpected("assessReplacement"),
  replaceRoot: notExpected("replaceRoot"),
  runMaintenance: notExpected("runMaintenance"),
};

const state = () =>
  createBackupRestoreState({
    backupService: { create: notExpected("create") },
    restoreService: {
      preflight: notExpected("preflight"),
      commit: notExpected("commit"),
    },
    fileGateway: {
      read: notExpected("read"),
      download: notExpected("download"),
    },
  });

test("公開section mountはoperation policyを利用し、一度だけcleanupする", async () => {
  let allowed = false;
  const listeners = new Set<() => void>();
  const section: BackupRestoreSectionMount = createBackupRestoreSectionMount({
    data,
    state: state(),
  });
  const container = document.createElement("div");

  let handle: FeatureMountHandle | undefined;
  await act(async () => {
    handle = await section.mount({
      container,
      operationPolicy: {
        isAllowed: () => allowed,
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      reportError: () => {},
    });
  });

  const exportButton = container.querySelector<HTMLButtonElement>(
    'button[data-action="export"]',
  );
  assert.ok(exportButton);
  assert.equal(exportButton.disabled, true);
  assert.equal(listeners.size, 1);

  allowed = true;
  await act(async () => {
    for (const listener of listeners) listener();
  });
  assert.equal(exportButton.disabled, false);

  await act(async () => handle?.unmount());
  await act(async () => handle?.unmount());
  assert.equal(container.textContent, "");
  assert.equal(listeners.size, 0);
});

test("回復操作だけが許可される状態ではexportを無効にしてrestore入力を維持する", async () => {
  const section: BackupRestoreSectionMount = createBackupRestoreSectionMount({
    data,
    state: state(),
  });
  const container = document.createElement("div");
  const handle = await section.mount({
    container,
    operationPolicy: {
      isAllowed: (kind) => kind === "read" || kind === "recovery",
      subscribe: () => () => {},
    },
    reportError: () => {},
  });
  const exportButton = container.querySelector<HTMLButtonElement>(
    'button[data-action="export"]',
  );
  const restoreInput = container.querySelector<HTMLInputElement>(
    'input[type="file"]',
  );
  assert.ok(exportButton);
  assert.ok(restoreInput);
  assert.equal(exportButton.disabled, true);
  assert.equal(restoreInput.disabled, false);
  await handle.unmount();
});

test("React root取得後のmount失敗は購読とDOM resourceを解放する", async () => {
  let policyUnsubscribed = 0;
  const idle = { phase: "idle" as const };
  const failingState = {
    get value() {
      return idle;
    },
    subscribe() {
      throw new Error("state subscribe failed");
    },
    resetForMount() {},
  } as unknown as ReturnType<typeof state>;
  const section = createBackupRestoreSectionMount({
    data,
    state: failingState,
  });
  const container = document.createElement("div");

  const reactGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  };
  const actEnvironment = reactGlobal.IS_REACT_ACT_ENVIRONMENT;
  reactGlobal.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    await assert.rejects(
      section.mount({
        container,
        operationPolicy: {
          isAllowed: () => true,
          subscribe: () => () => {
            policyUnsubscribed += 1;
          },
        },
        reportError: () => {},
      }),
    );
  } finally {
    reactGlobal.IS_REACT_ACT_ENVIRONMENT = actEnvironment;
  }
  assert.equal(container.textContent, "");
  assert.equal(policyUnsubscribed, 1);
});

test("unmount後の再mountは一時ticketを破棄し購読を重複させない", async () => {
  const ticket = {
    candidate: {},
    preview: {
      createdAt: "2026-07-24T00:00:00.000Z" as never,
      formatVersion: 1,
      projectCount: 1,
      partCount: 1,
      currentBuildCount: 0,
      estimatedBytes: 100,
    },
  };
  const reusableState = createBackupRestoreState({
    backupService: { create: notExpected("create") },
    restoreService: {
      preflight: async () => ({ ok: true, value: ticket }),
      commit: notExpected("commit"),
    },
    fileGateway: {
      read: async () => ({ ok: true, value: { text: "{}", byteLength: 2 } }),
      download: notExpected("download"),
    },
  });
  const listeners = new Set<() => void>();
  const section = createBackupRestoreSectionMount({
    data,
    state: reusableState,
  });
  const container = document.createElement("div");
  const context = {
    container,
    operationPolicy: {
      isAllowed: () => true,
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    reportError: () => {},
  };

  let first: FeatureMountHandle | undefined;
  await act(async () => {
    first = await section.mount(context);
    await reusableState.validateFile({} as File);
  });
  assert.ok(container.querySelector('[data-region="restore-confirmation"]'));
  assert.equal(listeners.size, 1);
  await act(async () => first?.unmount());
  assert.equal(listeners.size, 0);

  let second: FeatureMountHandle | undefined;
  await act(async () => {
    second = await section.mount(context);
  });
  assert.equal(reusableState.value.phase, "idle");
  assert.equal(
    container.querySelector('[data-region="restore-confirmation"]'),
    null,
  );
  assert.equal(listeners.size, 1);
  await act(async () => second?.unmount());
  assert.equal(listeners.size, 0);
});

test("validating中のunmount後は旧mountの遅延結果を再mountへ反映しない", async () => {
  let resolveRead!: (value: {
    ok: true;
    value: { text: string; byteLength: number };
  }) => void;
  const pendingRead = new Promise<{
    ok: true;
    value: { text: string; byteLength: number };
  }>((resolve) => {
    resolveRead = resolve;
  });
  const reusableState = createBackupRestoreState({
    backupService: { create: notExpected("create") },
    restoreService: {
      preflight: async () => {
        throw new Error("stale preflight must not run");
      },
      commit: notExpected("commit"),
    },
    fileGateway: {
      read: async () => pendingRead,
      download: notExpected("download"),
    },
  });
  const section = createBackupRestoreSectionMount({
    data,
    state: reusableState,
  });
  const container = document.createElement("div");
  const context = {
    container,
    operationPolicy: {
      isAllowed: () => true,
      subscribe: () => () => {},
    },
    reportError: () => {},
  };
  const phase = () => reusableState.value.phase;

  let first!: Awaited<ReturnType<typeof section.mount>>;
  await act(async () => {
    first = await section.mount(context);
  });
  let staleOperation!: ReturnType<typeof reusableState.validateFile>;
  await act(() => {
    staleOperation = reusableState.validateFile({} as File);
  });
  assert.equal(phase(), "validating");
  await act(async () => first.unmount());
  let second!: Awaited<ReturnType<typeof section.mount>>;
  await act(async () => {
    second = await section.mount(context);
  });
  assert.equal(phase(), "idle");
  resolveRead({ ok: true, value: { text: "{}", byteLength: 2 } });
  await act(async () => staleOperation);
  assert.equal(phase(), "idle");
  assert.equal(
    container.querySelector('[data-region="restore-confirmation"]'),
    null,
  );
  await act(async () => second.unmount());
});
