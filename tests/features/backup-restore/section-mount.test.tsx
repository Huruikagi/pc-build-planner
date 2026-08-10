import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";

import type {
  FeatureMountHandle,
  OperationKind,
} from "../../../src/application-shell/public.js";
import type {
  BackupRestoreSectionDependencies,
  BackupRestoreSectionMount,
} from "../../../src/features/backup-restore/public.js";
import { createBackupRestoreSectionMount } from "../../../src/features/backup-restore/public.js";
import { createBackupRestoreState } from "../../../src/features/backup-restore/state.js";
import {
  unattachedContextDependencies,
  unusedSectionCapabilities,
} from "./state-context-harness.js";

const notExpected = (label: string) => (): never => {
  throw new Error(`must not call ${label}`);
};

/** factoryが受け取るのは四つのcapabilityだけで、通常CRUDやshell内部は渡らない。 */
const rejectNonCapabilityDependencies = (
  dependencies: BackupRestoreSectionDependencies,
): void => {
  // @ts-expect-error ordinary root mutations never reach the section.
  void dependencies.read.mutate;
  // @ts-expect-error the section never receives a raw foundation data port.
  void dependencies.data;
  // @ts-expect-error project selection stays with project-context.
  void dependencies.projectContext.select;
  // @ts-expect-error the guard registry is not a section capability.
  void dependencies.replacementGuard.registry;
  // @ts-expect-error the section never receives Chrome storage.
  void dependencies.storage;
};
void rejectNonCapabilityDependencies;

const state = () =>
  createBackupRestoreState({
    ...unattachedContextDependencies(),
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

const allowingPolicy = (allowed: (kind: OperationKind) => boolean) => {
  const listeners = new Set<() => void>();
  return {
    listeners,
    policy: {
      isAllowed: allowed,
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
};

test("公開section mountはoperation policyを利用し、一度だけcleanupする", async () => {
  let allowed = false;
  const { listeners, policy } = allowingPolicy(() => allowed);
  const section: BackupRestoreSectionMount = createBackupRestoreSectionMount({
    ...unusedSectionCapabilities(),
    state: state(),
  });
  const container = document.createElement("div");

  let handle: FeatureMountHandle | undefined;
  await act(async () => {
    handle = await section.mount({
      container,
      operationPolicy: policy,
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

test("recovery-required相当のpolicyではread操作を保ち、commitだけをrecoveryとして判定する", async () => {
  const observed: OperationKind[] = [];
  const section = createBackupRestoreSectionMount({
    ...unusedSectionCapabilities(),
    state: state(),
  });
  const container = document.createElement("div");
  const handle = await section.mount({
    container,
    operationPolicy: {
      isAllowed: (kind) => {
        observed.push(kind);
        return kind === "read" || kind === "recovery";
      },
      subscribe: () => () => {},
    },
    reportError: () => {},
  });

  const exportButton = container.querySelector<HTMLButtonElement>(
    'button[data-action="export"]',
  );
  const restoreInput =
    container.querySelector<HTMLInputElement>('input[type="file"]');
  assert.ok(exportButton);
  assert.ok(restoreInput);
  /** export・file選択はreadであり、recovery-required中も利用できる。 */
  assert.equal(exportButton.disabled, false);
  assert.equal(restoreInput.disabled, false);
  /** 購読するcapabilityはreadとrecoveryだけで、通常mutationは判定に使わない。 */
  assert.deepEqual([...new Set(observed)].sort(), ["read", "recovery"]);
  await handle.unmount();
});

test("通常maintenance中はcommitを拒否し、export・file選択だけを許可する", async () => {
  /** shellのmutation gateと同じ判定: active maintenanceではrecoveryも拒否される。 */
  const section = createBackupRestoreSectionMount({
    ...unusedSectionCapabilities(),
    state: state(),
  });
  const container = document.createElement("div");
  const handle = await section.mount({
    container,
    operationPolicy: {
      isAllowed: (kind) => kind === "read",
      subscribe: () => () => {},
    },
    reportError: () => {},
  });

  const exportButton = container.querySelector<HTMLButtonElement>(
    'button[data-action="export"]',
  );
  const restoreInput =
    container.querySelector<HTMLInputElement>('input[type="file"]');
  assert.ok(exportButton);
  assert.ok(restoreInput);
  assert.equal(exportButton.disabled, false);
  assert.equal(restoreInput.disabled, false);
  await handle.unmount();
});

test("commit可否は置換確認とfinalizeのactionだけを支配する", async () => {
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
  const confirming = createBackupRestoreState({
    ...unattachedContextDependencies(),
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
  const section = createBackupRestoreSectionMount({
    ...unusedSectionCapabilities(),
    state: confirming,
  });
  const container = document.createElement("div");
  let handle: FeatureMountHandle | undefined;
  await act(async () => {
    handle = await section.mount({
      container,
      operationPolicy: {
        isAllowed: (kind) => kind === "read",
        subscribe: () => () => {},
      },
      reportError: () => {},
    });
    await confirming.validateFile({} as File);
  });

  const confirm = container.querySelector<HTMLButtonElement>(
    'button[data-action="confirm"]',
  );
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  assert.ok(confirm);
  assert.ok(input);
  /** commitはrecoveryとして拒否されるが、read側のfile再選択は生きている。 */
  assert.equal(confirm.disabled, true);
  assert.equal(input.disabled, false);
  await act(async () => handle?.unmount());
});

test("mountはpending finalizationを再水和してから最初の描画を行う", async () => {
  const finalization = "finalization-remount" as never;
  const rehydrated = createBackupRestoreState({
    ...unattachedContextDependencies(),
    backupService: { create: notExpected("create") },
    restoreService: {
      preflight: notExpected("preflight"),
      commit: notExpected("commit"),
      findPendingFinalization: async () => ({ ok: true, value: finalization }),
    },
    fileGateway: {
      read: notExpected("read"),
      download: notExpected("download"),
    },
  });
  const section = createBackupRestoreSectionMount({
    ...unusedSectionCapabilities(),
    state: rehydrated,
  });
  const container = document.createElement("div");

  let handle: FeatureMountHandle | undefined;
  await act(async () => {
    handle = await section.mount({
      container,
      operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
      reportError: () => {},
    });
  });

  assert.deepEqual(rehydrated.value, {
    phase: "restored-finalization-required",
    finalization,
  });
  assert.ok(
    container.querySelector('[data-region="restore-finalization"]'),
    "finalize-only区画が初回描画で表示される",
  );
  await act(async () => handle?.unmount());
});

test("root読取が利用不能でもmountは成功し、復元入力を提供する", async () => {
  /** 保存rootがcorruptでもsection自体は表示でき、回復preflightへ進める。 */
  const section = createBackupRestoreSectionMount({
    ...unusedSectionCapabilities(),
    read: {
      async query() {
        return { ok: false, error: { code: "corrupt-data" } };
      },
    },
    restore: {
      ...unusedSectionCapabilities().restore,
      async findPendingFinalization() {
        return { ok: false, error: { code: "storage-unavailable" } };
      },
    },
  });
  const container = document.createElement("div");

  let handle: FeatureMountHandle | undefined;
  await act(async () => {
    handle = await section.mount({
      container,
      operationPolicy: {
        isAllowed: (kind) => kind === "read" || kind === "recovery",
        subscribe: () => () => {},
      },
      reportError: () => {},
    });
  });

  const restoreInput =
    container.querySelector<HTMLInputElement>('input[type="file"]');
  assert.ok(restoreInput);
  assert.equal(restoreInput.disabled, false);
  await act(async () => handle?.unmount());
});

test("context refreshが利用不能でもmountを拒否しない", async () => {
  /** detached portsのrefreshは`context-unavailable`を返すが、mountには影響しない。 */
  const section = createBackupRestoreSectionMount({
    ...unusedSectionCapabilities(),
    restore: {
      ...unusedSectionCapabilities().restore,
      async findPendingFinalization() {
        return { ok: true, value: null };
      },
    },
  });
  const container = document.createElement("div");
  let handle: FeatureMountHandle | undefined;
  await act(async () => {
    handle = await section.mount({
      container,
      operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
      reportError: () => {},
    });
  });
  assert.ok(container.querySelector('[data-region="restore"]'));
  await act(async () => handle?.unmount());
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
    async rehydratePendingFinalization() {},
  } as unknown as ReturnType<typeof state>;
  const section = createBackupRestoreSectionMount({
    ...unusedSectionCapabilities(),
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

test("cleanupが失敗したunmountは再試行でき、成功後は冪等になる", async () => {
  const mounted = state();
  const section = createBackupRestoreSectionMount({
    ...unusedSectionCapabilities(),
    state: mounted,
  });
  const container = document.createElement("div");
  let handle: FeatureMountHandle | undefined;
  await act(async () => {
    handle = await section.mount({
      container,
      operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
      reportError: () => {},
    });
  });
  assert.ok(handle);

  /** 一度目のcleanupだけを失敗させ、ownershipが解放されないことを確認する。 */
  const originalReplaceChildren = container.replaceChildren.bind(container);
  let failures = 0;
  container.replaceChildren = ((...nodes: readonly Node[]) => {
    if (failures === 0) {
      failures += 1;
      throw new Error("cleanup failed once");
    }
    return originalReplaceChildren(...nodes);
  }) as typeof container.replaceChildren;

  await assert.rejects(async () => {
    await act(async () => handle?.unmount());
  });
  container.replaceChildren = originalReplaceChildren;

  await act(async () => handle?.unmount());
  assert.equal(container.textContent, "");
  await act(async () => handle?.unmount());
  assert.equal(container.textContent, "");
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
    ...unattachedContextDependencies(),
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
  const { listeners, policy } = allowingPolicy(() => true);
  const section = createBackupRestoreSectionMount({
    ...unusedSectionCapabilities(),
    state: reusableState,
  });
  const container = document.createElement("div");
  const context = {
    container,
    operationPolicy: policy,
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
    ...unattachedContextDependencies(),
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
    ...unusedSectionCapabilities(),
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
