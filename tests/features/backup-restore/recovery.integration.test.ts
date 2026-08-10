import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { act } from "react";

import { createApplicationShellIntegration } from "../../../src/application-shell/application-shell-integration.js";
import type { CompositionFeature } from "../../../src/application-shell/composition-root.js";
import type {
  FeatureId,
  ShellViewState,
} from "../../../src/application-shell/contracts.js";
import { createFeatureRegistry } from "../../../src/application-shell/feature-registry.js";
import { createSidePanelFeatureContributions } from "../../../src/application-shell/side-panel-contributions.js";
import type { UtcTimestamp } from "../../../src/domain/public.js";
import { schemaValidator } from "../../../src/domain/public.js";
import {
  createInMemoryStorageAdapter,
  createInMemoryStorageState,
} from "../../../src/persistence/in-memory-storage-adapter.js";
import { maintenancePolicy } from "../../../src/persistence/maintenance.js";
import { createMigrationRegistry } from "../../../src/persistence/migration-registry.js";
import { createMutationPipeline } from "../../../src/persistence/mutation-pipeline.js";
import type {
  MaintenanceSnapshot,
  MaintenanceSnapshotSource,
} from "../../../src/persistence/public.js";
import { createRecoveryCoordinator } from "../../../src/persistence/recovery.js";
import { referenceRepairPolicy } from "../../../src/persistence/reference-repair-policy.js";
import { createReplacementCoordinator } from "../../../src/persistence/replacement.js";
import { createLocalDataRepository } from "../../../src/persistence/repository.js";
import { createRootTransactionRunner } from "../../../src/persistence/root-transaction-runner.js";
import { createInMemoryRootWriteLock } from "../../../src/persistence/root-write-lock.js";
import { createInitialRoot } from "../../../src/persistence/schema.js";
import {
  createBackupRestoreDataPort,
  createWriteAuthority,
} from "../../../src/persistence/write-authority.js";
import type { ProjectContextSnapshot } from "../../../src/project-context/public.js";
import { defaultMessageResolver } from "../../../src/ui-messages/public.js";
import { buildCurrentBackupEnvelope } from "../../fixtures/backup.js";
import { detachedProjectReplacementGuard } from "../../fixtures/project-context-ports.js";
import { idleTransientSurface } from "../../fixtures/transient-surface.js";

const timestamp = "2026-08-10T00:00:00.000Z" as UtcTimestamp;
const settingsId = "settings" as FeatureId;
const candidateManagementId = "candidate-management" as FeatureId;

/** raw値を公開しない破損root。migrationもschema検証も通らない形にする。 */
const corruptRoot = { schemaVersion: 1, revision: "broken" };
const unsupportedRoot = { schemaVersion: 99, opaque: "synthetic" };
const healthyRoot = createInitialRoot();

const createFoundation = (stored: unknown) => {
  const state = createInMemoryStorageState({ quotaBytes: 10_000_000 });
  state.entries.set("localDataRoot", stored);
  const storage = createInMemoryStorageAdapter(state);
  const migrations = createMigrationRegistry(1, [], schemaValidator);
  const replacement = createReplacementCoordinator(migrations, schemaValidator);
  const runner = createRootTransactionRunner({
    storage,
    lock: createInMemoryRootWriteLock(),
    migrations,
    validator: schemaValidator,
    maintenance: maintenancePolicy,
    replacement,
    recovery: createRecoveryCoordinator(storage, migrations, replacement),
    now: () => timestamp,
    initialRoot: createInitialRoot,
  });
  return {
    data: createWriteAuthority({
      repository: createLocalDataRepository(storage, migrations),
      runner,
      pipeline: createMutationPipeline(schemaValidator, referenceRepairPolicy),
    }),
    backupRestoreData: createBackupRestoreDataPort(runner),
  };
};

const snapshot = (revision: number): MaintenanceSnapshot =>
  ({
    generation: 0,
    revision,
    active: false,
  }) as unknown as MaintenanceSnapshot;

/** 起動時snapshotと、その後の正常通知を別々に駆動できるsource。 */
const createMaintenanceSource = (
  initial:
    | { readonly ok: true; readonly value: MaintenanceSnapshot }
    | { readonly ok: false; readonly error: { readonly code: string } },
) => {
  const listeners = new Set<(value: MaintenanceSnapshot) => void>();
  const source: MaintenanceSnapshotSource = {
    async getSnapshot() {
      return initial as never;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    source,
    emit(value: MaintenanceSnapshot) {
      for (const listener of [...listeners]) listener(value);
    },
  };
};

/** 復元後にだけreadyへ遷移する、refresh capabilityだけのproject-context stub。 */
const createProjectRefresh = () => {
  let restored = false;
  return {
    markRestored() {
      restored = true;
    },
    port: {
      async refresh(): Promise<
        | { readonly ok: true; readonly value: ProjectContextSnapshot }
        | {
            readonly ok: false;
            readonly error: { readonly kind: "context-unavailable" };
          }
      > {
        return restored
          ? {
              ok: true,
              value: {
                status: "empty",
                generation: 1,
                catalog: [],
                selectedProjectId: null,
              },
            }
          : { ok: false, error: { kind: "context-unavailable" } };
      },
    },
  };
};

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

const waitUntil = async (
  predicate: () => boolean,
  attempts = 100,
): Promise<void> => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("condition did not become true in time");
};

const query = <E extends Element>(
  container: HTMLElement,
  selector: string,
): E => {
  const element = container.querySelector<E>(selector);
  assert.ok(element, `expected element for selector ${selector}`);
  return element;
};

/**
 * production compositionと同じ入口だけでshellを組み立てる。
 * backup/restoreへはsection mountだけが合成され、shell内部は渡らない。
 */
const createShellHarness = (options: {
  readonly stored: unknown;
  readonly initialMaintenance:
    | { readonly ok: true; readonly value: MaintenanceSnapshot }
    | { readonly ok: false; readonly error: { readonly code: string } };
}) => {
  const foundation = createFoundation(options.stored);
  const projectRefresh = createProjectRefresh();
  const maintenance = createMaintenanceSource(options.initialMaintenance);
  const contributions = createSidePanelFeatureContributions(
    {
      data: foundation.data,
      navigator: {
        async activate() {
          return { ok: true as const, value: undefined };
        },
      },
    },
    {
      backupRestoreData: foundation.backupRestoreData,
      projectReplacementGuard: detachedProjectReplacementGuard(),
      projectRefresh: projectRefresh.port,
      transientSurface: idleTransientSurface,
    },
  );
  const registry = createFeatureRegistry();
  const composed: readonly CompositionFeature[] = contributions;
  for (const feature of composed) {
    const registered = registry.register(feature.registration);
    assert.equal(registered.ok, true);
  }
  const container = document.createElement("div");
  const states: ShellViewState[] = [];
  const integration = createApplicationShellIntegration({
    registry,
    container,
    maintenanceSource: maintenance.source,
    onStateChange: (state) => states.push(state),
    reportError: () => {},
  });
  const [candidateManagement] = contributions;
  return {
    container,
    integration,
    states,
    maintenance,
    projectRefresh,
    candidateQuery: candidateManagement.registration.publicApi.query,
    latest: () => states[states.length - 1],
  };
};

const backupFile = (): File =>
  new File([JSON.stringify(buildCurrentBackupEnvelope())], "backup.json", {
    type: "application/json",
  });

/** file選択から置換確定までを、公開されたDOM操作面だけで駆動する。 */
const restoreThroughSection = async (container: HTMLElement): Promise<void> => {
  const input = query<HTMLInputElement>(container, 'input[type="file"]');
  assert.equal(input.disabled, false);
  Object.defineProperty(input, "files", {
    value: fakeFileList(backupFile()),
    configurable: true,
  });
  await act(async () => {
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
    await waitUntil(
      () =>
        container.querySelector('[data-region="restore-confirmation"]') !==
        null,
    );
  });
  const confirm = query<HTMLButtonElement>(
    container,
    'button[data-action="confirm"]',
  );
  assert.equal(confirm.disabled, false);
  const restoring = defaultMessageResolver("backup.restoring");
  await act(async () => {
    confirm.click();
    /** 置換確認が消え、処理中案内も残らない状態までがcommit完了である。 */
    await waitUntil(
      () =>
        container.querySelector('[data-region="restore-confirmation"]') ===
          null && !(container.textContent ?? "").includes(restoring),
      200,
    );
  });
};

for (const degraded of [
  { name: "破損root", stored: corruptRoot, code: "corrupt-data" },
  {
    name: "未対応version root",
    stored: unsupportedRoot,
    code: "unsupported-version",
  },
] as const) {
  test(`${degraded.name}の初期snapshotだけがsettingsをrecovery-requiredでmountする`, async () => {
    const harness = createShellHarness({
      stored: degraded.stored,
      initialMaintenance: { ok: false, error: { code: degraded.code } },
    });
    try {
      await act(async () => {
        const started = await harness.integration.start();
        assert.equal(started.ok, true);
      });

      const state = harness.latest();
      assert.equal(state?.kind, "recovery-required");
      if (state?.kind !== "recovery-required") return;
      assert.equal(state.selected, settingsId);

      const policy = harness.integration.operationPolicy;
      assert.equal(policy.isAllowed("read"), true);
      assert.equal(policy.isAllowed("recovery"), true);
      /** 通常mutationはfail closed。回復完了までCRUDを再開させない。 */
      assert.equal(policy.isAllowed("mutation"), false);

      /** 回復中は管理featureへ切り替えられず、settings区画だけが到達点になる。 */
      const selected = await harness.integration.select(candidateManagementId);
      assert.equal(selected.ok, false);

      /** context unavailableでもexportとfile選択は利用できる。 */
      assert.equal(
        query<HTMLButtonElement>(
          harness.container,
          'button[data-action="export"]',
        ).disabled,
        false,
      );
      assert.equal(
        query<HTMLInputElement>(harness.container, 'input[type="file"]')
          .disabled,
        false,
      );
    } finally {
      await act(async () => harness.integration.stop());
    }
  });
}

test("正常起動では同じsection公開境界を通常projectionのまま利用する", async () => {
  const harness = createShellHarness({
    stored: healthyRoot,
    initialMaintenance: { ok: true, value: snapshot(0) },
  });
  try {
    await act(async () => {
      const started = await harness.integration.start();
      assert.equal(started.ok, true);
    });
    await act(async () => {
      const selected = await harness.integration.select(settingsId);
      assert.equal(selected.ok, true);
    });

    assert.equal(harness.latest()?.kind, "ready");
    const policy = harness.integration.operationPolicy;
    assert.equal(policy.isAllowed("read"), true);
    assert.equal(policy.isAllowed("mutation"), true);

    /** 回復経路と同じDOM操作面・同じsection mountで通常復元が完了する。 */
    harness.projectRefresh.markRestored();
    await restoreThroughSection(harness.container);
    assert.equal(harness.container.querySelector('[role="alert"]'), null);

    const projects = await harness.candidateQuery.listProjects();
    assert.equal(projects.ok, true);
    if (!projects.ok) return;
    assert.equal(projects.value.length, 1);
  } finally {
    await act(async () => harness.integration.stop());
  }
});

test("回復commit後の最初の正常snapshotで通常projectionへ復帰し管理featureを再開する", async () => {
  const harness = createShellHarness({
    stored: corruptRoot,
    initialMaintenance: { ok: false, error: { code: "corrupt-data" } },
  });
  try {
    await act(async () => {
      const started = await harness.integration.start();
      assert.equal(started.ok, true);
    });
    assert.equal(harness.latest()?.kind, "recovery-required");

    /** 復元成功後にだけcontextがreadyまたはemptyへ再検証される。 */
    harness.projectRefresh.markRestored();
    await restoreThroughSection(harness.container);

    assert.equal(
      harness.container.querySelector('[role="alert"]'),
      null,
      "回復commitは分類済みerrorを残さない",
    );
    /** root writeは一回で、finalize-only/refresh-only状態は残らない。 */
    assert.equal(
      harness.container.querySelector('[data-region="restore-finalization"]'),
      null,
    );
    assert.equal(
      harness.container.querySelector(
        '[data-region="restore-context-refresh"]',
      ),
      null,
    );

    /** shell gateは正常snapshotを受けるまで通常mutationを拒否し続ける。 */
    assert.equal(
      harness.integration.operationPolicy.isAllowed("mutation"),
      false,
    );

    await act(async () => {
      harness.maintenance.emit(snapshot(1));
    });
    assert.equal(harness.latest()?.kind, "ready");
    assert.equal(
      harness.integration.operationPolicy.isAllowed("mutation"),
      true,
    );

    /** 復帰後は候補管理featureへ切り替えでき、復元済みデータを読める。 */
    const selected = await act(async () =>
      harness.integration.select(candidateManagementId),
    );
    assert.equal(selected.ok, true);
    const projects = await harness.candidateQuery.listProjects();
    assert.equal(projects.ok, true);
    if (!projects.ok) return;
    assert.equal(projects.value.length, 1);
  } finally {
    await act(async () => harness.integration.stop());
  }
});

test("backup/restore内部はshell compositionとstorageへdeep importしない", async () => {
  const forbidden = [
    /from "\.\.\/\.\.\/application-shell\/(?!public\.js)/,
    /from "\.\.\/\.\.\/persistence\/(?!public\.js)/,
    /from "\.\.\/\.\.\/project-context\/(?!public\.js)/,
    /side-panel-contributions/,
    /application-composition/,
    /chrome\.storage/,
  ];
  const sources = [
    "contracts.ts",
    "context-lifecycle.ts",
    "capacity-policy.ts",
    "exchange.ts",
    "file-gateway.ts",
    "operation-kind.ts",
    "public.ts",
    "react-root.tsx",
    "section-mount.ts",
    "service.ts",
    "state.ts",
    "view.tsx",
  ];

  for (const name of sources) {
    const source = await readFile(
      `src/features/backup-restore/${name}`,
      "utf8",
    );
    for (const pattern of forbidden) {
      assert.doesNotMatch(source, pattern, `${name} violates ${pattern}`);
    }
  }
});
