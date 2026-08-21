import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";

import type {
  Availability,
  FeatureMountHandle,
} from "../../../src/application-shell/contracts.js";
import type {
  CandidatePartId,
  ProjectId,
  Revision,
  UtcTimestamp,
  Uuid,
} from "../../../src/domain/public.js";
import type {
  CandidateDraft,
  CandidateManagementService,
  CandidateQuery,
  UnresolvedCandidateEditorPrefill,
} from "../../../src/features/candidate-management/contracts.js";
import type { DuplicateMergeCoordinator } from "../../../src/features/candidate-management/duplicate-merge.js";
import { createProjectContextAdapter } from "../../../src/features/candidate-management/project-context-adapter.js";
import type { CandidateFeatureRegistrationDependencies } from "../../../src/features/candidate-management/registration.js";
import { createCandidateFeatureRegistration as createCandidateFeatureRegistrationImpl } from "../../../src/features/candidate-management/registration.js";
import { createManagementState } from "../../../src/features/candidate-management/state.js";
import type { FoundationScopedDataPort } from "../../../src/persistence/public.js";
import type { ProjectContextSnapshot } from "../../../src/project-context/public.js";
import { actWrappedRegistrationFactory } from "../../act-wrapped-registration.js";
import { collectFeatureContractViolations } from "../../contracts/application-shell-contract-kit.js";

const createCalls: Array<readonly [CandidateDraft, unknown]> = [];
const createHandler = async () => {
  throw new Error("create is not exercised by registration tests");
};
const createCandidateFeatureRegistration = actWrappedRegistrationFactory(
  (dependencies: Omit<CandidateFeatureRegistrationDependencies, "create">) =>
    createCandidateFeatureRegistrationImpl({
      ...dependencies,
      create: {
        async createCandidate(draft, context) {
          createCalls.push([draft, context]);
          return createHandler();
        },
      },
    }),
);

test("候補管理registrationはshell契約へmount依存とoperation policyを注入する", async () => {
  const data = {} as FoundationScopedDataPort;
  const query = {} as CandidateQuery;
  const observed: {
    data?: FoundationScopedDataPort;
    readAllowed?: boolean;
    mutationAllowed?: boolean;
  } = {};
  const availabilityListeners = new Set<(value: Availability) => void>();
  const registration = createCandidateFeatureRegistration({
    data,
    query,
    subscribeAvailability(listener) {
      availabilityListeners.add(listener);
      return () => availabilityListeners.delete(listener);
    },
    mount: async ({ data: mountedData, operationPolicy, container }) => {
      observed.data = mountedData;
      observed.readAllowed = operationPolicy.isAllowed("read");
      observed.mutationAllowed = operationPolicy.isAllowed("mutation");
      container.textContent = "Candidate management";
      const handle: FeatureMountHandle = {
        async unmount() {
          container.textContent = "";
        },
      };
      return handle;
    },
  });

  assert.equal(typeof registration.publicApi.query.listProjects, "function");
  assert.equal(
    typeof registration.publicApi.query.getCandidateDraft,
    "function",
  );
  assert.equal("capture" in registration.publicApi, false);
  assert.equal(
    typeof registration.publicApi.sources.catalog.listSourceReferences,
    "function",
  );
  assert.equal(
    typeof registration.publicApi.sources.catalog.getSourceReference,
    "function",
  );
  assert.equal(
    typeof registration.publicApi.sources.mutations.addSource,
    "function",
  );
  assert.deepEqual(
    await registration.publicApi.sources.catalog.listSourceReferences({}),
    { ok: false, error: { code: "storage-unavailable" } },
  );
  const violations = await collectFeatureContractViolations(registration, {
    emitAvailability: () => {
      for (const listener of availabilityListeners)
        listener({ status: "available" });
    },
  });

  assert.deepEqual(violations, []);
  assert.equal(observed.data, data);
  assert.equal(observed.readAllowed, true);
  assert.equal(observed.mutationAllowed, true);
});

test("feature lifecycleはmountごとに開始しunmountで一度だけ解放する", async () => {
  let starts = 0;
  let releases = 0;
  const registration = createCandidateFeatureRegistration({
    data: {} as FoundationScopedDataPort,
    query: {} as CandidateQuery,
    lifecycle: {
      start() {
        starts += 1;
        let active = true;
        return {
          ok: true as const,
          value: () => {
            if (!active) return;
            active = false;
            releases += 1;
          },
        };
      },
    },
    mount: async () => ({ async unmount() {} }),
  });
  const context = {
    container: document.createElement("div"),
    operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
    reportError: () => {},
  };

  const first = await registration.mount(context);
  await first.unmount();
  await first.unmount();
  const second = await registration.mount(context);
  await second.unmount();

  assert.equal(starts, 2);
  assert.equal(releases, 2);
});

test("React rootはopaque snapshotを復元し、captureとunmountを一度だけ行う", async () => {
  const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
  const candidateId =
    "30000000-0000-4000-8000-000000000001" as Uuid as CandidatePartId;
  const draft = {
    projectId,
    category: "uncategorized" as const,
    product: { name: { original: "未保存の架空候補" } },
    normalizedAttributes: { category: "uncategorized" as const },
    sources: [],
  } satisfies CandidateDraft;
  let contextRefreshes = 0;
  const currentProject = (snapshot: ProjectContextSnapshot) =>
    createProjectContextAdapter({
      read: {
        getSnapshot: () => snapshot,
        subscribe: () => () => {},
      },
      commands: {
        async refresh() {
          contextRefreshes += 1;
          return { ok: true as const, value: snapshot };
        },
      },
    });
  const readySnapshot: ProjectContextSnapshot = {
    status: "ready",
    generation: 1,
    catalog: [
      {
        id: projectId,
        name: "架空プロジェクト",
        updatedAt: "2026-07-22T00:00:00.000Z" as UtcTimestamp,
      },
    ],
    selectedProjectId: projectId,
  };
  const query = {
    async listProjects() {
      return {
        ok: true as const,
        value: [
          {
            id: projectId,
            name: "架空プロジェクト",
            updatedAt: "2026-07-22T00:00:00.000Z" as never,
          },
        ],
      };
    },
    async listCandidates() {
      return {
        ok: true as const,
        value: [
          {
            id: candidateId,
            projectId,
            category: "uncategorized" as const,
            name: { original: "保存済みの架空候補" },
            hasMissingDetails: true,
            updatedAt: "2026-07-22T00:00:00.000Z" as never,
          },
        ],
      };
    },
    async listBuildEligible() {
      return { ok: true as const, value: [] };
    },
    async getCandidateDraft() {
      return {
        ok: false as const,
        error: {
          code: "validation" as const,
          reason: "entity-not-found" as const,
          message: "candidate",
        },
      };
    },
  } satisfies CandidateQuery;
  const matchedSummary = {
    id: candidateId,
    projectId,
    category: "uncategorized" as const,
    name: { original: "保存済みの架空候補" },
    hasMissingDetails: true,
    updatedAt: "2026-07-22T00:00:00.000Z" as never,
  };
  const duplicateMergeCoordinator: DuplicateMergeCoordinator = {
    async evaluate() {
      return {
        ok: true,
        value: {
          kind: "decision-required",
          matches: [
            {
              candidateId,
              confidence: "high",
              evidence: { kind: "model-number" },
              summary: matchedSummary,
            },
          ],
        },
      };
    },
    async complete() {
      throw new Error("not used");
    },
  };
  const state = createManagementState({
    query,
    service: {} as CandidateManagementService,
    createMutationContext: () => ({
      requestId: "20000000-0000-4000-8000-000000000001" as never,
      expectedRevision: 0 as Revision,
    }),
    duplicateMergeCoordinator,
    currentProject: currentProject(readySnapshot),
  });
  const sourceRegistration = createCandidateFeatureRegistration({
    data: {} as FoundationScopedDataPort,
    query: {} as CandidateQuery,
    state,
  });
  const sourceContainer = document.createElement("div");
  const sourceHandle = await sourceRegistration.mount({
    container: sourceContainer,
    operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
    reportError: () => {},
  });
  // The editor is opened on the mounted screen, which is what capture must keep.
  await act(() => state.beginCreate(draft));
  await act(() => state.saveEditor());
  await act(() => state.selectDuplicateCandidate(candidateId));
  const captured = await sourceHandle.captureState?.();
  assert.equal(captured?.ok, true);
  await sourceHandle.unmount();
  await sourceHandle.unmount();

  const restoredState = createManagementState({
    query,
    service: {} as CandidateManagementService,
    createMutationContext: () => ({
      requestId: "20000000-0000-4000-8000-000000000001" as never,
      expectedRevision: 0 as Revision,
    }),
    duplicateMergeCoordinator,
    currentProject: currentProject(readySnapshot),
  });
  const targetRegistration = createCandidateFeatureRegistration({
    data: {} as FoundationScopedDataPort,
    query: {} as CandidateQuery,
    state: restoredState,
  });
  const targetContainer = document.createElement("div");
  const targetHandle = await targetRegistration.mount({
    container: targetContainer,
    operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
    reportError: () => {},
    restoredState: captured?.ok ? captured.value : undefined,
  });
  assert.deepEqual(restoredState.value.editor, {
    mode: "create",
    projectId,
    draft,
  });
  assert.equal(restoredState.value.duplicateDecision.status, "deciding");
  assert.equal(
    restoredState.value.duplicateDecision.status === "deciding"
      ? restoredState.value.duplicateDecision.selectedCandidateId
      : undefined,
    candidateId,
  );
  assert.equal(contextRefreshes, 0);
  await targetHandle.unmount();
  assert.equal(targetContainer.textContent, "");

  const rejectedState = createManagementState({
    query,
    service: {} as CandidateManagementService,
    createMutationContext: () => ({
      requestId: "20000000-0000-4000-8000-000000000001" as never,
      expectedRevision: 0 as Revision,
    }),
  });
  const rejectedHandle = await createCandidateFeatureRegistration({
    data: {} as FoundationScopedDataPort,
    query: {} as CandidateQuery,
    state: rejectedState,
  }).mount({
    container: document.createElement("div"),
    operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
    reportError: () => {},
    restoredState: { version: 99 },
  });
  assert.equal(rejectedState.value.editor, null);
  assert.deepEqual(rejectedState.value.displayError, {
    code: "snapshot-restore-failed",
  });
  await rejectedHandle.unmount();

  const rejectedContexts: readonly ProjectContextSnapshot[] = [
    {
      ...readySnapshot,
      selectedProjectId:
        "10000000-0000-4000-8000-000000000099" as Uuid as ProjectId,
    },
    { status: "empty", generation: 2, catalog: [], selectedProjectId: null },
    {
      status: "unavailable",
      generation: 3,
      selectedProjectId: null,
      reason: "catalog-unavailable",
    },
  ];
  for (const snapshot of rejectedContexts) {
    const rejectedContextState = createManagementState({
      query,
      service: {} as CandidateManagementService,
      createMutationContext: () => ({
        requestId: "20000000-0000-4000-8000-000000000001" as never,
        expectedRevision: 0 as Revision,
      }),
      currentProject: currentProject(snapshot),
    });
    const rejectedContextHandle = await createCandidateFeatureRegistration({
      data: {} as FoundationScopedDataPort,
      query,
      state: rejectedContextState,
    }).mount({
      container: document.createElement("div"),
      operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
      reportError: () => {},
      restoredState: captured?.ok ? captured.value : undefined,
    });
    assert.equal(rejectedContextState.value.editor, null);
    assert.deepEqual(rejectedContextState.value.displayError, {
      code: "snapshot-restore-failed",
    });
    await rejectedContextHandle.unmount();
  }
  const missingAuthorityState = createManagementState({
    query,
    service: {} as CandidateManagementService,
    createMutationContext: () => ({
      requestId: "20000000-0000-4000-8000-000000000001" as never,
      expectedRevision: 0 as Revision,
    }),
  });
  const missingAuthorityContainer = document.createElement("div");
  const missingAuthorityHandle = await createCandidateFeatureRegistration({
    data: {} as FoundationScopedDataPort,
    query,
    state: missingAuthorityState,
  }).mount({
    container: missingAuthorityContainer,
    operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
    reportError: () => {},
    restoredState: captured?.ok ? captured.value : undefined,
  });
  assert.equal(missingAuthorityState.value.editor, null);
  assert.deepEqual(missingAuthorityState.value.displayError, {
    code: "snapshot-restore-failed",
  });
  assert.equal(
    missingAuthorityContainer.querySelectorAll("[data-project-id]").length,
    0,
  );
  await missingAuthorityHandle.unmount();
  assert.equal(contextRefreshes, 0);
});

test("snapshotなしの再mountは前回の未保存draftと削除確認を持ち越さない", async () => {
  const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
  const candidateId =
    "10000000-0000-4000-8000-000000000002" as Uuid as CandidatePartId;
  const query = {
    async listProjects() {
      return {
        ok: true as const,
        value: [
          {
            id: projectId,
            name: "架空プロジェクト",
            updatedAt: "2026-07-22T00:00:00.000Z" as never,
          },
        ],
      };
    },
    async listCandidates() {
      return { ok: true as const, value: [] };
    },
    async listBuildEligible() {
      return { ok: true as const, value: [] };
    },
    async getCandidateDraft() {
      return {
        ok: false as const,
        error: {
          code: "validation" as const,
          reason: "entity-not-found" as const,
          message: "candidate",
        },
      };
    },
  } satisfies CandidateQuery;
  // A single state instance outlives both mounts, as in production composition.
  const state = createManagementState({
    query,
    service: {} as CandidateManagementService,
    createMutationContext: () => ({
      requestId: "20000000-0000-4000-8000-000000000001" as never,
      expectedRevision: 0 as Revision,
    }),
  });
  const registration = createCandidateFeatureRegistration({
    data: {} as FoundationScopedDataPort,
    query: {} as CandidateQuery,
    state,
  });
  const policy = { isAllowed: () => true, subscribe: () => () => {} };

  const first = await registration.mount({
    container: document.createElement("div"),
    operationPolicy: policy,
    reportError: () => {},
  });
  await act(() =>
    state.beginCreate({
      projectId,
      category: "uncategorized",
      product: { name: { original: "未保存の架空候補" } },
      normalizedAttributes: { category: "uncategorized" },
    }),
  );
  await act(() => state.requestDeletion({ kind: "candidate", candidateId }));
  await first.unmount();

  // Navigating back is not a rollback, so the previous screen must not reappear.
  const second = await registration.mount({
    container: document.createElement("div"),
    operationPolicy: policy,
    reportError: () => {},
  });

  assert.equal(state.value.editor, null);
  assert.equal(state.value.deletion, null);
  assert.equal(state.value.displayError, null);
  assert.deepEqual(state.value.projects.length, 1);
  await second.unmount();
});

test("capture handoffのpending pre-editは同一panel sessionで保持し、新しいdocument sessionへ復元しない", async () => {
  const query = {
    async listProjects() {
      return { ok: true as const, value: [] };
    },
    async listCandidates() {
      return { ok: true as const, value: [] };
    },
    async listBuildEligible() {
      return { ok: true as const, value: [] };
    },
    async getCandidateDraft() {
      return {
        ok: false as const,
        error: {
          code: "validation" as const,
          reason: "entity-not-found" as const,
          message: "candidate",
        },
      };
    },
  } satisfies CandidateQuery;
  const createState = () =>
    createManagementState({
      query,
      service: {} as CandidateManagementService,
      createMutationContext: () => ({
        requestId: "20000000-0000-4000-8000-000000000001" as never,
        expectedRevision: 0 as Revision,
      }),
      currentProject: {
        getCurrentProject: () => ({ status: "unresolved" }),
        subscribe: () => () => {},
        async refresh() {
          return {
            ok: false,
            error: { kind: "context-unavailable" },
          };
        },
      },
    });
  const pending = {
    draft: {
      category: "uncategorized",
      product: { name: { original: "架空の抽出候補" } },
      normalizedAttributes: { category: "uncategorized" },
    },
  } satisfies UnresolvedCandidateEditorPrefill;
  let subscriptions = 0;
  let releases = 0;
  const policy = {
    isAllowed: () => true,
    subscribe() {
      subscriptions += 1;
      return () => {
        releases += 1;
      };
    },
  };
  const sessionState = createState();
  const registration = createCandidateFeatureRegistration({
    data: {} as FoundationScopedDataPort,
    query,
    state: sessionState,
  });

  const firstContainer = document.createElement("div");
  const first = await registration.mount({
    container: firstContainer,
    operationPolicy: policy,
    reportError: () => {},
  });
  const validated = registration.activation?.validate({
    featureId: registration.id,
    target: "open-candidate-editor",
    payload: pending,
  });
  assert.equal(validated?.ok, true);
  if (validated === undefined || !validated.ok)
    throw new Error("candidate activation must validate");
  // Successful activation is the handoff boundary after which capture may end.
  let activated:
    | Awaited<
        ReturnType<NonNullable<typeof registration.activation>["activate"]>
      >
    | undefined;
  await act(async () => {
    activated = await registration.activation?.activate(validated.value);
  });
  assert.deepEqual(activated, { ok: true, value: undefined });
  assert.deepEqual(sessionState.value.pendingPreEdit, pending);
  const captured = await first.captureState?.();
  await first.unmount();
  assert.equal(releases, 1);
  assert.equal(firstContainer.textContent, "");
  // A post-unmount state notification must not recreate or update the React UI.
  sessionState.rejectSnapshotRestore();
  assert.equal(firstContainer.textContent, "");
  assert.deepEqual(sessionState.value.pendingPreEdit, pending);

  const second = await registration.mount({
    container: document.createElement("div"),
    operationPolicy: policy,
    reportError: () => {},
    restoredState: captured?.ok ? captured.value : undefined,
  });
  assert.deepEqual(sessionState.value.pendingPreEdit, pending);
  assert.deepEqual(sessionState.value.displayError, {
    code: "project-required",
  });
  await second.unmount();
  assert.equal(subscriptions, 2);
  assert.equal(releases, 2);

  // A recreated composition models a new side-panel document. The opaque
  // feature snapshot deliberately excludes panel-session-only pre-edit data.
  const recreatedState = createState();
  const recreated = await createCandidateFeatureRegistration({
    data: {} as FoundationScopedDataPort,
    query,
    state: recreatedState,
  }).mount({
    container: document.createElement("div"),
    operationPolicy: policy,
    reportError: () => {},
    restoredState: captured?.ok ? captured.value : undefined,
  });
  assert.equal(recreatedState.value.pendingPreEdit, null);
  await recreated.unmount();
  assert.equal(subscriptions, 3);
  assert.equal(releases, 3);
});

test("mountできるstateを持たないregistrationはmountを成功と偽らない", async () => {
  const registration = createCandidateFeatureRegistration({
    data: {} as FoundationScopedDataPort,
    query: {} as CandidateQuery,
  });
  const container = document.createElement("div");

  await assert.rejects(
    registration.mount({
      container,
      operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
      reportError: () => {},
    }),
    /no management state to mount/,
  );
  // A rejected mount must not leave placeholder content behind.
  assert.equal(container.textContent, "");
  assert.equal(registration.activation, undefined);
});

test("mount中のactivation拒否だけをfeature診断へ安定コードで通知する", async () => {
  const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
  const query = {
    async listProjects() {
      return {
        ok: true as const,
        value: [
          {
            id: projectId,
            name: "架空プロジェクト",
            updatedAt: "2026-07-22T00:00:00.000Z" as never,
          },
        ],
      };
    },
    async listCandidates() {
      return { ok: true as const, value: [] };
    },
    async listBuildEligible() {
      return { ok: true as const, value: [] };
    },
    async getCandidateDraft() {
      return {
        ok: false as const,
        error: {
          code: "validation" as const,
          reason: "entity-not-found" as const,
          message: "candidate",
        },
      };
    },
  } satisfies CandidateQuery;
  const state = createManagementState({
    query,
    service: {} as CandidateManagementService,
    createMutationContext: () => {
      throw new Error("not used");
    },
  });
  const registration = createCandidateFeatureRegistration({
    data: {} as FoundationScopedDataPort,
    query,
    state,
  });
  const diagnostics: string[] = [];
  const handle = await registration.mount({
    container: document.createElement("div"),
    operationPolicy: {
      isAllowed: (operation) => operation !== "mutation",
      subscribe: () => () => {},
    },
    reportError: (message) => diagnostics.push(message),
  });
  const validated = registration.activation?.validate({
    featureId: registration.id,
    target: "open-candidate-editor",
    payload: {
      draft: {
        category: "uncategorized",
        product: { name: { original: "架空の取り込み候補" } },
        normalizedAttributes: { category: "uncategorized" },
      },
    },
  });
  assert.equal(validated?.ok, true);
  if (validated === undefined || !validated.ok) return;

  let rejected:
    | Awaited<
        ReturnType<NonNullable<typeof registration.activation>["activate"]>
      >
    | undefined;
  await act(async () => {
    rejected = await registration.activation?.activate(validated.value);
  });
  assert.equal(rejected?.ok, false);
  assert.deepEqual(diagnostics, ["activation-editor-mutation-disabled"]);
  await handle.unmount();
  await act(async () => {
    await registration.activation?.activate(validated.value);
  });
  assert.deepEqual(diagnostics, ["activation-editor-mutation-disabled"]);
});

test("mount した panel session だけが current context 回復で pending pre-edit を再開する", async () => {
  const projectId = "10000000-0000-4000-8000-000000000051" as Uuid as ProjectId;
  const query = {
    async listProjects() {
      return { ok: true as const, value: [] };
    },
    async listCandidates() {
      return { ok: true as const, value: [] };
    },
    async listBuildEligible() {
      return { ok: true as const, value: [] };
    },
    async getCandidateDraft() {
      return {
        ok: false as const,
        error: {
          code: "validation" as const,
          reason: "entity-not-found" as const,
          message: "candidate",
        },
      };
    },
  } satisfies CandidateQuery;
  const listeners = new Set<() => void>();
  let current: ProjectId | null = null;
  const state = createManagementState({
    query,
    service: {} as CandidateManagementService,
    createMutationContext: () => ({
      requestId: "20000000-0000-4000-8000-000000000051" as never,
      expectedRevision: 0 as Revision,
    }),
    currentProject: {
      getCurrentProject: () =>
        current === null
          ? { status: "unresolved" as const }
          : { status: "resolved" as const, projectId: current },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  });
  const pending = {
    draft: {
      category: "uncategorized",
      product: { name: { original: "架空の回復待ち候補" } },
      normalizedAttributes: { category: "uncategorized" },
    },
  } satisfies UnresolvedCandidateEditorPrefill;
  const registration = createCandidateFeatureRegistration({
    data: {} as FoundationScopedDataPort,
    query,
    state,
  });

  const handle = await registration.mount({
    container: document.createElement("div"),
    operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
    reportError: () => {},
  });
  state.holdPendingPreEdit(pending);
  await act(async () => {
    current = projectId;
    for (const listener of listeners) listener();
  });
  assert.equal(state.value.pendingPreEdit, null);
  assert.equal(state.value.editor?.projectId, projectId);

  await handle.unmount();
  assert.equal(listeners.size, 0);
  // After the session ends, a context change must not reopen an unmounted editor.
  state.holdPendingPreEdit(pending);
  current = null;
  for (const listener of listeners) listener();
  assert.deepEqual(state.value.pendingPreEdit, pending);
});
