import { createRoot } from "react-dom/client";

import {
  err,
  ok,
  type Project,
  type ProjectId,
  type RequestId,
  type Revision,
  type UtcTimestamp,
} from "../../src/domain/public.js";
import { createProjectCatalogProjection } from "../../src/project-context/catalog.js";
import type {
  ProjectCatalogItem,
  ProjectLifecycleDataPort,
} from "../../src/project-context/contracts.js";
import type { ProjectLifecycleMessageDescriptor } from "../../src/project-context/lifecycle-message-descriptors.js";
import { createProjectLifecyclePresentationContribution } from "../../src/project-context/lifecycle-presentation.js";
import { createProjectLifecycleService } from "../../src/project-context/lifecycle-service.js";
import { createProjectLifecycleState } from "../../src/project-context/lifecycle-state.js";
import { createInMemoryProjectPreferencePort } from "../../src/project-context/preference-store.js";
import { createProjectContextPublicApi } from "../../src/project-context/public.js";
import { ProjectSelector } from "../../src/project-context/selector.js";
import { createProjectContextService } from "../../src/project-context/service.js";
import { LanguageProvider } from "../../src/ui-language/public.js";

const ids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
] as const satisfies readonly ProjectId[];

const timestamp = "2026-01-01T00:00:00Z" as UtcTimestamp;
const initialProjects = (): Project[] =>
  ids.slice(0, 2).map((id, index) => ({
    id,
    name: index === 0 ? "架空アルファ" : "架空ブラボー",
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
let projects = initialProjects();
let catalogUnavailable = false;
let confirmationRequired = false;
let forcedNotifications = 0;
const preference = createInMemoryProjectPreferencePort();
let service = createService();
let api: ReturnType<typeof createProjectContextPublicApi>;
let root: ReturnType<typeof createRoot> | undefined;
let lifecycleHandle: { unmount(): void } | undefined;
let lifecycleLocale: "ja" | "en" = "ja";
let failMutation = false;
let failRefresh = false;
let mutationCount = 0;
let createdProjectIndex = 2;
const messageListeners = new Set<() => void>();

const catalogItems = (): readonly ProjectCatalogItem[] =>
  projects.map(({ id, name, updatedAt }) => ({ id, name, updatedAt }));

function createService() {
  const next = createProjectContextService({
    catalog: createProjectCatalogProjection({
      async list() {
        return catalogUnavailable
          ? { ok: false, error: { kind: "source-unavailable" as const } }
          : ok(catalogItems());
      },
    }),
    preference,
  });
  if (confirmationRequired)
    next.registerGuard({
      id: "harness-confirmation",
      async evaluate() {
        return ok({ kind: "confirmation-required" });
      },
      notifyForced() {
        forcedNotifications += 1;
      },
    });
  return next;
}

const render = async () => {
  await service.initialize();
  api = createProjectContextPublicApi({ service });
  const container = document.querySelector<HTMLElement>("#root");
  if (container === null) throw new Error("Missing test harness root.");
  root?.unmount();
  root = createRoot(container);
  root.render(
    <LanguageProvider>
      <ProjectSelector read={api.read} commands={api.commands} />
    </LanguageProvider>,
  );
  lifecycleHandle?.unmount();
  let lifecycleContainer = document.querySelector<HTMLElement>(
    "[data-project-lifecycle-host='true']",
  );
  if (lifecycleContainer === null) {
    lifecycleContainer = document.createElement("div");
    lifecycleContainer.dataset.projectLifecycleHost = "true";
    document.body.append(lifecycleContainer);
  }
  const data: ProjectLifecycleDataPort = {
    async createMutationContext() {
      return ok({
        requestId: "99999999-9999-4999-8999-999999999999" as RequestId,
        expectedRevision: 1 as Revision,
      });
    },
    async find(projectId) {
      return ok(projects.find(({ id }) => id === projectId));
    },
    async mutate(operation) {
      mutationCount += 1;
      if (failMutation) {
        failMutation = false;
        return err({ kind: "conflict" as const });
      }
      if (operation.kind === "create") projects.push(operation.project);
      else if (operation.kind === "update")
        projects = projects.map((project) =>
          project.id === operation.project.id ? operation.project : project,
        );
      else projects = projects.filter(({ id }) => id !== operation.projectId);
      return ok({ revision: 2 as Revision, replayed: false });
    },
  };
  const lifecycle = createProjectLifecycleService({
    data,
    context: {
      async refresh() {
        if (failRefresh) {
          failRefresh = false;
          return err({ kind: "context-unavailable" as const });
        }
        return api.commands.refresh();
      },
    },
    createProjectId: () => ids[createdProjectIndex++] ?? ids[3],
    now: () => timestamp,
  });
  const lifecycleState = createProjectLifecycleState({
    read: api.read,
    lifecycle,
  });
  const contribution = createProjectLifecyclePresentationContribution({
    read: api.read,
    lifecycle,
    state: lifecycleState,
    messages: {
      getSnapshot: () => lifecycleLocale,
      subscribe(listener) {
        messageListeners.add(listener);
        return () => messageListeners.delete(listener);
      },
      resolve: resolveLifecycleMessage,
    },
  });
  const mounted = contribution.mount(lifecycleContainer);
  if (!mounted.ok) throw new Error("Unable to mount lifecycle harness.");
  lifecycleHandle = mounted.value;
  return api;
};

function resolveLifecycleMessage(
  descriptor: ProjectLifecycleMessageDescriptor,
): string {
  const projectName = "projectName" in descriptor ? descriptor.projectName : "";
  const messages =
    lifecycleLocale === "ja"
      ? {
          "project-list": "架空プロジェクト一覧",
          "create-project": "架空プロジェクトを作成",
          "rename-project": `${projectName} の名前を変更`,
          "confirm-delete": `${projectName} を削除します。所属する架空候補も削除されます。`,
          "name-required": "名前を入力してください。",
          "operation-pending": "架空プロジェクトを更新中です。",
          "operation-failed": "架空プロジェクトの操作に失敗しました。",
          "retry-refresh": "一覧だけ再読み込み",
          "confirm-delete-action": "削除する",
          "cancel-delete": "キャンセル",
          "cancel-rename": "名前変更をキャンセル",
          "create-project-action": "作成",
          "save-project-name-action": "名前を保存",
        }
      : {
          "project-list": "Synthetic project list",
          "create-project": "Create synthetic project",
          "rename-project": `Rename ${projectName}`,
          "confirm-delete": `Delete ${projectName}. Its synthetic candidates will also be deleted.`,
          "name-required": "Enter a name.",
          "operation-pending": "Updating the synthetic project.",
          "operation-failed": "The synthetic project operation failed.",
          "retry-refresh": "Refresh list only",
          "confirm-delete-action": "Delete",
          "cancel-delete": "Cancel",
          "cancel-rename": "Cancel rename",
          "create-project-action": "Create",
          "save-project-name-action": "Save name",
        };
  return messages[descriptor.intent];
}

void render().then(() =>
  Object.assign(window, {
    projectContextHarness: {
      ids,
      async setCatalog(names: readonly string[]) {
        projects = names.map((name, index) => ({
          id: ids[index] ?? ids[0],
          name,
          createdAt: timestamp,
          updatedAt: timestamp,
        }));
        await api.commands.refresh();
      },
      async setCatalogUnavailable(value: boolean, refresh = true) {
        catalogUnavailable = value;
        if (refresh) await api.commands.refresh();
      },
      async requireConfirmation(value: boolean) {
        confirmationRequired = value;
        service = createService();
        await render();
      },
      async reopen() {
        service = createService();
        await render();
      },
      async replace(
        outcome: "succeeded" | "failed" | "cancelled",
        stale = false,
      ) {
        const prepared = await api.replacementGuard.prepare();
        if (!prepared.ok) return prepared;
        const permit =
          prepared.value.kind === "permitted"
            ? prepared.value.permit
            : await api.replacementGuard.confirm(
                prepared.value.confirmation.id,
              );
        if (!permit.ok) return permit;
        if (stale) await api.commands.refresh();
        const begun = api.replacementGuard.begin(permit.value.id);
        if (!begun.ok) return begun;
        const completed = await api.replacementGuard.complete(
          permit.value.id,
          outcome,
        );
        if (completed.ok && outcome === "succeeded")
          await api.commands.refresh();
        return completed;
      },
      forcedNotifications() {
        return forcedNotifications;
      },
      snapshot() {
        return service.getSnapshot();
      },
      setLifecycleLocale(locale: "ja" | "en") {
        lifecycleLocale = locale;
        for (const listener of messageListeners) listener();
      },
      failNextLifecycleMutation() {
        failMutation = true;
      },
      failNextLifecycleRefresh() {
        failRefresh = true;
      },
      lifecycleMutationCount() {
        return mutationCount;
      },
      async resetLifecycle() {
        projects = initialProjects();
        failMutation = false;
        failRefresh = false;
        mutationCount = 0;
        createdProjectIndex = 2;
        service = createService();
        await render();
      },
    },
  }),
);
