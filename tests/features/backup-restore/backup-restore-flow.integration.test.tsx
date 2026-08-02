import assert from "node:assert/strict";
import test from "node:test";
import { userEvent } from "@testing-library/user-event";
import { act } from "react";
import { createSidePanelFeatureContributions } from "../../../src/application-shell/side-panel-contributions.js";
import type {
  CandidatePartId,
  ProjectId,
  RequestId,
  Revision,
  UtcTimestamp,
  Uuid,
} from "../../../src/domain/public.js";
import { schemaValidator } from "../../../src/domain/public.js";
import { createBackupRestoreSectionMount } from "../../../src/features/backup-restore/public.js";
import { createBackupRestoreState } from "../../../src/features/backup-restore/state.js";
import { createCandidateManagementService } from "../../../src/features/candidate-management/service.js";
import { createSettingsFeatureRegistration } from "../../../src/features/settings/public.js";
import {
  createInMemoryStorageAdapter,
  createInMemoryStorageState,
} from "../../../src/persistence/in-memory-storage-adapter.js";
import { maintenancePolicy } from "../../../src/persistence/maintenance.js";
import { createMigrationRegistry } from "../../../src/persistence/migration-registry.js";
import { createMutationPipeline } from "../../../src/persistence/mutation-pipeline.js";
import { referenceRepairPolicy } from "../../../src/persistence/reference-repair-policy.js";
import { createReplacementCoordinator } from "../../../src/persistence/replacement.js";
import { createLocalDataRepository } from "../../../src/persistence/repository.js";
import { createRootTransactionRunner } from "../../../src/persistence/root-transaction-runner.js";
import { createInMemoryRootWriteLock } from "../../../src/persistence/root-write-lock.js";
import { createInitialRoot } from "../../../src/persistence/schema.js";
import { createWriteAuthority } from "../../../src/persistence/write-authority.js";
import { resetUiLanguageForTest } from "../../../src/ui-language/store.js";
import {
  defaultMessageResolver,
  resolverFor,
} from "../../../src/ui-messages/public.js";
import { idleTransientSurface } from "../../fixtures/transient-surface.js";

const timestamp = "2026-07-25T00:00:00.000Z" as UtcTimestamp;
const projectId = "10000000-0000-4000-8000-000000000091" as Uuid as ProjectId;
const candidateId =
  "30000000-0000-4000-8000-000000000091" as Uuid as CandidatePartId;
let requestSequence = 0;

const nextRequest = (): RequestId =>
  `20000000-0000-4000-8000-${String(++requestSequence).padStart(12, "0")}` as Uuid as RequestId;

const createFoundationPort = () => {
  const storageState = createInMemoryStorageState({ quotaBytes: 10_000_000 });
  const storage = createInMemoryStorageAdapter(storageState);
  const migrations = createMigrationRegistry(1, [], schemaValidator);
  const runner = createRootTransactionRunner({
    storage,
    lock: createInMemoryRootWriteLock(),
    migrations,
    validator: schemaValidator,
    maintenance: maintenancePolicy,
    replacement: createReplacementCoordinator(migrations, schemaValidator),
    now: () => timestamp,
    initialRoot: createInitialRoot,
  });
  return createWriteAuthority({
    repository: createLocalDataRepository(storage, migrations),
    runner,
    pipeline: createMutationPipeline(schemaValidator, referenceRepairPolicy),
  });
};

const policy = { isAllowed: () => true, subscribe: () => () => {} };

const waitUntil = async (
  predicate: () => boolean,
  attempts = 50,
): Promise<void> => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("condition did not become true in time");
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

test("実foundationを共有する settings 構成で言語変更を挟んでも backup state と復元後データを保持する", async () => {
  const data = createFoundationPort();

  const seedService = createCandidateManagementService({
    data,
    now: () => timestamp,
    createProjectId: () => projectId,
    createCandidateId: () => candidateId,
  });
  const created = await seedService.createProject(
    { name: "架空バックアップ統合構成" },
    { requestId: nextRequest(), expectedRevision: 0 as Revision },
  );
  assert.equal(created.ok, true);
  const candidateCreated = await seedService.createCandidate(
    {
      projectId,
      category: "memory",
      product: {
        name: { original: "架空メモリ統合候補", confirmed: "SYN-MEMORY" },
      },
      sources: [],
      normalizedAttributes: {
        category: "memory",
        memoryStandard: { original: "架空規格", confirmed: "SYN-DDR" },
      },
    },
    { requestId: nextRequest(), expectedRevision: 1 as Revision },
  );
  assert.equal(candidateCreated.ok, true);

  const contributions = createSidePanelFeatureContributions(
    {
      data,
      navigator: {
        async activate() {
          return { ok: true as const, value: undefined };
        },
      },
    },
    { backupRestoreData: data, transientSurface: idleTransientSurface },
  );
  const [candidateManagement, , , , settings] = contributions;

  const originalCreateObjectURL = URL.createObjectURL.bind(URL);
  const originalRevokeObjectURL = URL.revokeObjectURL.bind(URL);
  const originalClick = HTMLAnchorElement.prototype.click;
  const blobs: Blob[] = [];
  URL.createObjectURL = ((blob: Blob) => {
    blobs.push(blob);
    return originalCreateObjectURL(blob);
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  HTMLAnchorElement.prototype.click = function click() {};

  const container = document.createElement("div");
  let handle:
    | Awaited<ReturnType<typeof settings.registration.mount>>
    | undefined;
  try {
    await act(async () => {
      handle = await settings.registration.mount({
        container,
        operationPolicy: policy,
        reportError: () => {},
      });
    });

    const exportButton = container.querySelector(
      'button[data-action="export"]',
    ) as HTMLButtonElement;
    assert.ok(exportButton);
    await act(async () => {
      exportButton.click();
      await waitUntil(() => blobs.length === 1);
    });
    const exportedJson = await blobs[0]?.text();
    assert.ok(exportedJson);
    assert.match(exportedJson ?? "", /SYN-MEMORY/);

    // Simulate the user changing local data after taking the backup.
    const renamed = await seedService.renameProject(
      { id: projectId, name: "架空バックアップ統合構成（変更後）" },
      { requestId: nextRequest(), expectedRevision: 2 as Revision },
    );
    assert.equal(renamed.ok, true);

    const restoreFile = new File([exportedJson ?? ""], "restore.json", {
      type: "application/json",
    });
    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: fakeFileList(restoreFile),
      configurable: true,
    });
    await act(async () => {
      input.dispatchEvent(new window.Event("change", { bubbles: true }));
      await waitUntil(
        () => container.querySelector('button[data-action="confirm"]') !== null,
      );
    });
    // Preview shows counts only (Requirement 3.6/6.5), never entity names.
    assert.match(
      container.textContent ?? "",
      new RegExp(`${defaultMessageResolver("backup.projectCountLabel")}1`),
    );
    assert.doesNotMatch(
      container.textContent ?? "",
      /架空バックアップ統合構成/,
    );

    const confirmButton = container.querySelector(
      'button[data-action="confirm"]',
    ) as HTMLButtonElement;
    const languageSelect = container.querySelector<HTMLSelectElement>(
      '[data-region="language-select"]',
    );
    assert.ok(languageSelect);
    const settingsRoot = container.querySelector('[data-region="settings"]');
    const backupHost = container.querySelector(
      '[data-region="backup-restore-host"]',
    );
    assert.ok(settingsRoot);
    assert.ok(backupHost);
    await act(async () => {
      await userEvent.setup().selectOptions(languageSelect, "en");
    });
    assert.equal(
      container.querySelector('[data-region="settings"]'),
      settingsRoot,
    );
    assert.equal(
      container.querySelector('[data-region="backup-restore-host"]'),
      backupHost,
    );
    assert.equal(
      container.querySelector('button[data-action="confirm"]'),
      confirmButton,
    );
    await act(async () => {
      confirmButton.click();
      await waitUntil(
        () =>
          container.querySelector('[role="alert"]') === null &&
          (container.textContent ?? "").includes(
            resolverFor("en")("backup.restoreCompleted", {
              projectCount: 1,
              partCount: 1,
              currentBuildCount: 0,
            }),
          ),
      );
    });

    const projects =
      await candidateManagement.registration.publicApi.query.listProjects();
    assert.equal(projects.ok, true);
    if (projects.ok)
      assert.deepEqual(
        projects.value.map((project) => project.name),
        ["架空バックアップ統合構成"],
      );

    const maintenanceAfter = await data.query(
      (root) => root.maintenance.active,
    );
    assert.equal(maintenanceAfter.ok, true);
    if (maintenanceAfter.ok) assert.equal(maintenanceAfter.value, false);
  } finally {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    HTMLAnchorElement.prototype.click = originalClick;
    const mounted = handle;
    if (mounted !== undefined) await act(async () => mounted.unmount());
    resetUiLanguageForTest();
  }
});

test("settings公開mount下でmaintenance、分類済みerror、安全なfilename描画を保つ", async () => {
  const unsafe = '<img src=x onerror="alert(1)">';
  const state = createBackupRestoreState({
    backupService: {
      async create() {
        return {
          ok: true,
          value: {
            filename: `${unsafe}-backup.json`,
            mimeType: "application/json",
            json: "{}",
            byteLength: 2,
          },
        };
      },
    },
    restoreService: {
      async preflight() {
        return {
          ok: false,
          error: { code: "invalid-structure", path: unsafe },
        };
      },
      async commit() {
        throw new Error("commit must not run after failed preflight");
      },
    },
    fileGateway: {
      download: () => ({ ok: true, value: undefined }),
      read: async () => ({
        ok: true,
        value: { text: "{}", byteLength: 2 },
      }),
    },
  });
  let allowed = false;
  const listeners = new Set<() => void>();
  const operationPolicy = {
    isAllowed: () => allowed,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const registration = createSettingsFeatureRegistration({
    backupRestore: createBackupRestoreSectionMount({
      data: createFoundationPort(),
      state,
    }),
  });
  const container = document.createElement("div");
  let handle: Awaited<ReturnType<typeof registration.mount>> | undefined;
  try {
    await act(async () => {
      handle = await registration.mount({
        container,
        operationPolicy,
        reportError: () => {},
      });
    });
    const exportButton = container.querySelector<HTMLButtonElement>(
      'button[data-action="export"]',
    );
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    assert.ok(exportButton);
    assert.ok(input);
    assert.equal(exportButton.disabled, true);
    assert.equal(input.disabled, true);

    await act(async () => {
      allowed = true;
      for (const listener of listeners) listener();
    });
    assert.equal(exportButton.disabled, false);
    assert.equal(input.disabled, false);

    await act(async () => exportButton.click());
    assert.equal(container.querySelector("img"), null);
    assert.match(container.innerHTML, /&lt;img/);

    const invalidFile = new File(["{}"], "invalid.json", {
      type: "application/json",
    });
    Object.defineProperty(input, "files", {
      value: fakeFileList(invalidFile),
      configurable: true,
    });
    await act(async () => {
      input.dispatchEvent(new window.Event("change", { bubbles: true }));
      await waitUntil(() => container.querySelector('[role="alert"]') !== null);
    });
    const alert = container.querySelector('[role="alert"]');
    assert.ok(alert);
    assert.match(
      alert.textContent ?? "",
      new RegExp(defaultMessageResolver("backup.errors.invalid-structure")),
    );
    assert.doesNotMatch(alert.textContent ?? "", /<img src=x/);
    assert.equal(alert.querySelector("img"), null);
    assert.doesNotMatch(container.innerHTML, /&lt;img/);
  } finally {
    const mounted = handle;
    if (mounted !== undefined) await act(async () => mounted.unmount());
    resetUiLanguageForTest();
  }
});
