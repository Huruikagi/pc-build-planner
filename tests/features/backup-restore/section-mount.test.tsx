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
