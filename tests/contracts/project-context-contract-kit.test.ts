import assert from "node:assert/strict";
import test from "node:test";

import {
  ok,
  type ProjectId,
  type UtcTimestamp,
} from "../../src/domain/public.js";
import { createProjectCatalogProjection } from "../../src/project-context/catalog.js";
import type { ProjectLifecycleMessageDescriptor } from "../../src/project-context/lifecycle-message-descriptors.js";
import { createInMemoryProjectPreferencePort } from "../../src/project-context/preference-store.js";
import { createProjectContextPublicApi } from "../../src/project-context/public.js";
import { createProjectContextService } from "../../src/project-context/service.js";
import {
  collectProjectContextSnapshotViolations,
  collectProjectLifecycleDownstreamContractViolations,
  collectReplacementContractViolations,
  collectUnavailableRecoveryContractViolations,
  projectLifecycleDescriptorContract,
} from "./project-context-contract-kit.js";

const A = "11111111-1111-4111-8111-111111111111" as ProjectId;

test("project-context contract kitは公開read portだけでready/empty/unavailableを検証する", async () => {
  let entries: readonly {
    id: ProjectId;
    name: string;
    updatedAt: UtcTimestamp;
  }[] = [
    {
      id: A,
      name: "架空プロジェクト",
      updatedAt: "2026-01-01T00:00:00Z" as UtcTimestamp,
    },
  ];
  let unavailable = false;
  const service = createProjectContextService({
    catalog: createProjectCatalogProjection({
      async list() {
        return unavailable
          ? { ok: false, error: { kind: "source-unavailable" as const } }
          : ok(entries);
      },
    }),
    preference: createInMemoryProjectPreferencePort(),
  });
  const api = createProjectContextPublicApi({ service });
  await service.initialize();
  assert.deepEqual(
    collectProjectContextSnapshotViolations(api, {
      status: "ready",
      selectedProjectId: A,
      minimumGeneration: 1,
    }),
    [],
  );
  entries = [];
  await api.commands.refresh();
  assert.deepEqual(
    collectProjectContextSnapshotViolations(api, {
      status: "empty",
      selectedProjectId: null,
      minimumGeneration: 2,
    }),
    [],
  );
  unavailable = true;
  await api.commands.refresh();
  assert.deepEqual(
    collectProjectContextSnapshotViolations(api, {
      status: "unavailable",
      selectedProjectId: null,
      minimumGeneration: 3,
    }),
    [],
  );
});

test("project-context contract kitはreplacement成功後だけ独立refreshを要求する", async () => {
  let refreshes = 0;
  const service = createProjectContextService({
    catalog: createProjectCatalogProjection({
      async list() {
        return ok([
          {
            id: A,
            name: "架空プロジェクト",
            updatedAt: "2026-01-01T00:00:00Z" as UtcTimestamp,
          },
        ]);
      },
    }),
    preference: createInMemoryProjectPreferencePort(),
  });
  await service.initialize();
  const api = createProjectContextPublicApi({ service });
  assert.deepEqual(
    await collectReplacementContractViolations({
      replacementGuard: api.replacementGuard,
      async commitReplacement() {
        return "succeeded";
      },
      async refresh() {
        refreshes += 1;
        await api.commands.refresh();
      },
    }),
    [],
  );
  assert.equal(refreshes, 1);
});

test("要件8.7: contract kitはunavailable時もsettings・backup recoveryの起動を要求する", async () => {
  const service = createProjectContextService({
    catalog: createProjectCatalogProjection({
      async list() {
        return { ok: false, error: { kind: "source-unavailable" as const } };
      },
    }),
    preference: createInMemoryProjectPreferencePort(),
  });
  await service.initialize();
  const api = createProjectContextPublicApi({ service });
  assert.equal(api.read.getSnapshot().status, "unavailable");

  // context に依存しない shell 起動経路は違反を出さない。
  assert.deepEqual(
    await collectUnavailableRecoveryContractViolations({
      context: api,
      openSettings: () => true,
      openBackupRecovery: async () => true,
    }),
    [],
  );

  // context ready を前提にした shell は復旧経路を塞ぐため検出される。
  const gatedOnReady = () => api.read.getSnapshot().status === "ready";
  assert.deepEqual(
    await collectUnavailableRecoveryContractViolations({
      context: api,
      openSettings: gatedOnReady,
      openBackupRecovery: gatedOnReady,
    }),
    [
      "recovery.settings: unavailable context blocked the settings entry point",
      "recovery.backup: unavailable context blocked the backup recovery entry point",
    ],
  );
});

test("要件8.7: unavailableでない状態で観測した契約はprecondition違反として拒否する", async () => {
  const service = createProjectContextService({
    catalog: createProjectCatalogProjection({
      async list() {
        return ok([
          {
            id: A,
            name: "架空プロジェクト",
            updatedAt: "2026-01-01T00:00:00Z" as UtcTimestamp,
          },
        ]);
      },
    }),
    preference: createInMemoryProjectPreferencePort(),
  });
  await service.initialize();
  const api = createProjectContextPublicApi({ service });
  assert.deepEqual(
    await collectUnavailableRecoveryContractViolations({
      context: api,
      openSettings: () => true,
      openBackupRecovery: () => true,
    }),
    [
      "recovery.precondition: subject must be observed while context is unavailable",
    ],
  );
});

test("8.4 downstream lifecycle kitはhost locator、capability注入、descriptor、旧UI撤去後期待値を固定する", () => {
  const descriptors: ProjectLifecycleMessageDescriptor[] = [];
  const host = {
    lifecycle: {
      create: async () => ({
        ok: false as const,
        error: { kind: "storage" as const },
      }),
      rename: async () => ({
        ok: false as const,
        error: { kind: "storage" as const },
      }),
      delete: async () => ({
        ok: false as const,
        error: { kind: "storage" as const },
      }),
      retryRefresh: async () => ({
        ok: false as const,
        error: { kind: "context-unavailable" as const },
      }),
    },
    messages: {
      resolve(descriptor: ProjectLifecycleMessageDescriptor) {
        descriptors.push(descriptor);
        return descriptor.intent;
      },
    },
    hostLocator: "[data-project-lifecycle-host='true']",
    presentationLocator: "[data-project-lifecycle='presentation']",
    legacyCandidateProjectUiCount: 0,
    revalidationTrigger: "ui-message-catalog+project-candidate-management",
    descriptorIntents: projectLifecycleDescriptorContract.map(
      ({ intent }) => intent,
    ),
  };
  assert.deepEqual(
    collectProjectLifecycleDownstreamContractViolations(host),
    [],
  );
  assert.equal(
    host.messages.resolve({ intent: "project-list" }),
    "project-list",
  );
  assert.deepEqual(descriptors, [{ intent: "project-list" }]);
  assert.deepEqual(
    projectLifecycleDescriptorContract.map(({ intent }) => intent),
    [
      "project-list",
      "create-project",
      "rename-project",
      "confirm-delete",
      "name-required",
      "operation-pending",
      "operation-failed",
      "retry-refresh",
      "confirm-delete-action",
      "cancel-delete",
      "cancel-rename",
      "create-project-action",
      "save-project-name-action",
    ],
  );
});

test("8.4 downstream lifecycle kitは各migration contract違反を個別に拒否する", () => {
  const valid = {
    lifecycle: {
      create: async () => ({
        ok: false as const,
        error: { kind: "storage" as const },
      }),
      rename: async () => ({
        ok: false as const,
        error: { kind: "storage" as const },
      }),
      delete: async () => ({
        ok: false as const,
        error: { kind: "storage" as const },
      }),
      retryRefresh: async () => ({
        ok: false as const,
        error: { kind: "context-unavailable" as const },
      }),
    },
    messages: { resolve: () => "synthetic" },
    hostLocator: "[data-project-lifecycle-host='true']",
    presentationLocator: "[data-project-lifecycle='presentation']",
    legacyCandidateProjectUiCount: 0,
    revalidationTrigger: "ui-message-catalog+project-candidate-management",
    descriptorIntents: projectLifecycleDescriptorContract.map(
      ({ intent }) => intent,
    ),
  };
  const violations = (patch: Record<string, unknown>) =>
    collectProjectLifecycleDownstreamContractViolations({
      ...valid,
      ...patch,
    } as typeof valid);
  assert.deepEqual(
    violations({ lifecycle: { ...valid.lifecycle, delete: undefined } }),
    ["lifecycle.capability: delete must be injected"],
  );
  assert.deepEqual(violations({ hostLocator: "" }), [
    "lifecycle.host: stable host locator changed",
  ]);
  assert.deepEqual(violations({ presentationLocator: "" }), [
    "lifecycle.presentation: stable presentation locator changed",
  ]);
  assert.deepEqual(violations({ legacyCandidateProjectUiCount: 1 }), [
    "lifecycle.migration: legacy candidate project UI remains",
  ]);
  assert.deepEqual(violations({ revalidationTrigger: "" }), [
    "lifecycle.revalidation: downstream trigger changed",
  ]);
  assert.deepEqual(violations({ descriptorIntents: ["project-list"] }), [
    "lifecycle.descriptors: semantic descriptor contract changed",
  ]);
});
