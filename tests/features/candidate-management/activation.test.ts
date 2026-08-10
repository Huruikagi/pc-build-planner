import assert from "node:assert/strict";
import test from "node:test";

import { createFeatureRegistry } from "../../../src/application-shell/feature-registry.js";
import type { FeatureId } from "../../../src/application-shell/public.js";
import { createActivationRouter } from "../../../src/application-shell/public.js";
import type { ProjectId, Uuid } from "../../../src/domain/public.js";
import { createCandidateActivation } from "../../../src/features/candidate-management/activation.js";
import type {
  CandidateManagementService,
  CandidateQuery,
  CurrentProjectPort,
  ProjectSummary,
} from "../../../src/features/candidate-management/contracts.js";
import { createCandidateFeatureRegistration } from "../../../src/features/candidate-management/registration.js";
import { createManagementState } from "../../../src/features/candidate-management/state.js";
import type { FoundationDataPort } from "../../../src/persistence/public.js";

const featureId = "candidate-management" as FeatureId;
const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const prefillProjectId =
  "10000000-0000-4000-8000-000000000002" as Uuid as ProjectId;
const unresolvedNamedDraft = {
  category: "uncategorized" as const,
  product: { name: { original: "架空の候補" } },
  normalizedAttributes: { category: "uncategorized" as const },
};
const draft = { ...unresolvedNamedDraft, projectId };

const unresolvedDraft = {
  category: "uncategorized" as const,
  product: { name: { original: null, confirmed: "" } },
  normalizedAttributes: { category: "uncategorized" as const },
};

const projects = [
  {
    id: projectId,
    name: "架空プロジェクト",
    updatedAt: "2026-07-22T00:00:00.000Z" as never,
  },
  {
    id: prefillProjectId,
    name: "編集先プロジェクト",
    updatedAt: "2026-07-22T00:00:00.000Z" as never,
  },
] as const;

/** Stands in for project-context: the only save-target authority. */
const currentContext = (initial: ProjectId | null) => {
  const listeners = new Set<() => void>();
  let current = initial;
  return {
    port: {
      getCurrentProject: () =>
        current === null
          ? ({ status: "unresolved" } as const)
          : ({ status: "resolved", projectId: current } as const),
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } satisfies CurrentProjectPort,
    recover(next: ProjectId | null) {
      current = next;
      for (const listener of listeners) listener();
    },
    get selected() {
      return current;
    },
  };
};

const createState = (
  availableProjects: readonly ProjectSummary[] = projects,
  currentProject: CurrentProjectPort = currentContext(projectId).port,
) =>
  createManagementState({
    currentProject,
    query: {
      async listProjects() {
        return {
          ok: true as const,
          value: availableProjects,
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
          error: { kind: "not-found" as const, entity: "candidate" as const },
        };
      },
    } satisfies CandidateQuery,
    service: {} as CandidateManagementService,
    createMutationContext: () => {
      throw new Error("not used");
    },
  });

const createRegistration = (state: ReturnType<typeof createState>) =>
  createCandidateFeatureRegistration({
    data: {} as FoundationDataPort,
    query: {} as CandidateQuery,
    state,
  });

test("activation は正常 prefill を一度だけ詳細編集へ適用し、不正な受信内容では既存画面を保持する", async () => {
  const state = createState(projects, currentContext(prefillProjectId).port);
  const prefill = { ...unresolvedNamedDraft, projectId: prefillProjectId };
  await state.load();
  const registry = createFeatureRegistry();
  assert.equal(registry.register(createRegistration(state)).ok, true);
  const router = createActivationRouter({ registry });

  for (const intent of [
    { featureId, target: "unknown", payload: { projectId, draft } },
    { featureId, target: "open-candidate-editor", payload: { projectId } },
  ]) {
    assert.equal(router.prepare(intent).ok, false);
    assert.equal(state.value.editor, null);
  }

  const prepared = router.prepare({
    featureId,
    target: "open-candidate-editor",
    payload: {
      projectId: prefillProjectId,
      draft: unresolvedNamedDraft,
      captureDiagnostics: [{ field: "price", reason: "invalid-format" }],
    },
  });
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  assert.deepEqual(await prepared.value.activate(), {
    ok: true,
    value: undefined,
  });
  assert.equal(state.value.selectedProjectId, prefillProjectId);
  assert.deepEqual(state.value.editor, {
    mode: "create",
    projectId: prefillProjectId,
    draft: prefill,
    captureDiagnostics: [{ field: "price", reason: "invalid-format" }],
  });
  assert.equal("captureDiagnostics" in state.value.editor.draft, false);
  assert.equal((await prepared.value.activate()).ok, false);
});

test("未解決 prefill は unknown 境界で再検証し、検証済み current project へ bind して空名 editor を開く", async () => {
  const state = createState(projects, currentContext(prefillProjectId).port);
  await state.load();
  const registry = createFeatureRegistry();
  assert.equal(registry.register(createRegistration(state)).ok, true);
  const router = createActivationRouter({ registry });

  const prepared = router.prepare({
    featureId,
    target: "open-candidate-editor",
    payload: { draft: unresolvedDraft },
  });
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  assert.deepEqual(await prepared.value.activate(), {
    ok: true,
    value: undefined,
  });
  assert.deepEqual(state.value.editor, {
    mode: "create",
    projectId: prefillProjectId,
    draft: { ...unresolvedDraft, projectId: prefillProjectId },
  });
});

test("payload の projectId と画面 snapshot は保存先に使わず current project へ bind する", async () => {
  const context = currentContext(projectId);
  const state = createState(projects, context.port);
  await state.load();
  // A stale screen selection must not survive as the save target either.
  await state.selectProject(prefillProjectId);
  const registry = createFeatureRegistry();
  assert.equal(registry.register(createRegistration(state)).ok, true);
  const prepared = createActivationRouter({ registry }).prepare({
    featureId,
    target: "open-candidate-editor",
    payload: { projectId: prefillProjectId, draft: unresolvedDraft },
  });

  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  assert.deepEqual(await prepared.value.activate(), {
    ok: true,
    value: undefined,
  });
  assert.equal(state.value.selectedProjectId, projectId);
  assert.equal(state.value.editor?.projectId, projectId);
  assert.equal(state.value.editor?.draft.projectId, projectId);
  // The stale input never rewrites the current context itself.
  assert.equal(context.selected, projectId);
});

test("不正な未解決 prefill は invalid_activation へ写像し state を変更しない", async () => {
  const state = createState();
  await state.load();
  const registry = createFeatureRegistry();
  assert.equal(registry.register(createRegistration(state)).ok, true);
  const result = createActivationRouter({ registry }).prepare({
    featureId,
    target: "open-candidate-editor",
    payload: { draft: { ...unresolvedDraft, unexpected: "untrusted" } },
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      kind: "invalid_activation",
      detail: "candidate editor prefill is invalid",
    },
  });
  assert.equal(state.value.editor, null);
});

test("projectIdを内包する旧resolved draftはcanonical activation境界で拒否する", async () => {
  const state = createState();
  await state.load();
  const registry = createFeatureRegistry();
  assert.equal(registry.register(createRegistration(state)).ok, true);

  const result = createActivationRouter({ registry }).prepare({
    featureId,
    target: "open-candidate-editor",
    payload: { projectId, draft },
  });

  assert.equal(result.ok, false);
  assert.equal(state.value.editor, null);
});

test("unknown activation の非object入力を副作用前に拒否する", async () => {
  for (const payload of [undefined, null, [], "prefill", 42]) {
    const state = createState();
    await state.load();
    const registry = createFeatureRegistry();
    assert.equal(registry.register(createRegistration(state)).ok, true);

    const result = createActivationRouter({ registry }).prepare({
      featureId,
      target: "open-candidate-editor",
      payload,
    });

    assert.deepEqual(result, {
      ok: false,
      error: {
        kind: "invalid_activation",
        detail: "candidate editor prefill is invalid",
      },
    });
    assert.equal(state.value.editor, null);
    assert.equal(state.value.pendingPreEdit, null);
    assert.equal(state.value.isSaving, false);
  }
});

test("project が0件でも未解決 prefill を pending に受理して capture 終了後まで保持する", async () => {
  const state = createState([], currentContext(null).port);
  await state.load();
  const registry = createFeatureRegistry();
  assert.equal(registry.register(createRegistration(state)).ok, true);
  const prepared = createActivationRouter({ registry }).prepare({
    featureId,
    target: "open-candidate-editor",
    payload: { draft: unresolvedDraft },
  });

  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  assert.deepEqual(await prepared.value.activate(), {
    ok: true,
    value: undefined,
  });
  assert.equal(state.value.editor, null);
  assert.deepEqual(state.value.pendingPreEdit, { draft: unresolvedDraft });
  assert.equal(state.value.isSaving, false);

  state.resetTransientState();
  assert.deepEqual(state.value.pendingPreEdit, { draft: unresolvedDraft });

  const replacement = {
    ...unresolvedDraft,
    product: { name: { original: "架空の後続抽出候補" } },
  };
  const next = createActivationRouter({ registry }).prepare({
    featureId,
    target: "open-candidate-editor",
    payload: { draft: replacement },
  });
  assert.equal(next.ok, true);
  if (!next.ok) return;
  assert.equal((await next.value.activate()).ok, true);
  assert.deepEqual(state.value.pendingPreEdit, { draft: replacement });
});

test("新しい pre-edit activation は保持中 pending を editor 受理後に破棄する", async () => {
  const replacement = {
    ...unresolvedDraft,
    product: { name: { original: "架空の交換候補" } },
  };
  const availableState = createState();
  await availableState.load();
  availableState.holdPendingPreEdit({ draft: unresolvedDraft });
  const availableRegistry = createFeatureRegistry();
  assert.equal(
    availableRegistry.register(createRegistration(availableState)).ok,
    true,
  );
  const next = createActivationRouter({ registry: availableRegistry }).prepare({
    featureId,
    target: "open-candidate-editor",
    payload: { draft: replacement },
  });
  assert.equal(next.ok, true);
  if (!next.ok) return;
  assert.equal((await next.value.activate()).ok, true);
  assert.equal(availableState.value.pendingPreEdit, null);
  assert.equal(
    availableState.value.editor?.draft.product.name.original,
    "架空の交換候補",
  );
});

test("mutation が禁止された状態の activation は編集画面を開かず失敗を返す", async () => {
  const state = createState();
  await state.load();
  await state.selectProject(projectId);
  // Maintenance closes the editor, so activation must not report success.
  state.attachOperationPolicy({
    isAllowed: (operation) => operation !== "mutation",
    subscribe: () => () => {},
  });
  const registry = createFeatureRegistry();
  assert.equal(registry.register(createRegistration(state)).ok, true);
  const prepared = createActivationRouter({ registry }).prepare({
    featureId,
    target: "open-candidate-editor",
    payload: {
      projectId: prefillProjectId,
      draft: unresolvedNamedDraft,
    },
  });

  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const before = structuredClone(state.value);
  assert.deepEqual(await prepared.value.activate(), {
    ok: false,
    error: {
      kind: "activation_failed",
      detail: "candidate editor could not be opened",
      reason: "operation-blocked",
    },
  });
  assert.deepEqual(state.value, before);
  state.releaseOperationPolicy();
});

test("activation拒否は商品payloadを含めず安定診断コードだけを通知する", async () => {
  const state = createState();
  await state.load();
  state.attachOperationPolicy({
    isAllowed: (operation) => operation !== "mutation",
    subscribe: () => () => {},
  });
  const diagnostics: string[] = [];
  const activation = createCandidateActivation(state, (code) =>
    diagnostics.push(code),
  );
  const validated = activation.validate({
    featureId,
    target: "open-candidate-editor",
    payload: { draft: unresolvedDraft },
  });
  assert.equal(validated.ok, true);
  if (!validated.ok) return;

  assert.equal((await activation.activate(validated.value)).ok, false);
  assert.deepEqual(diagnostics, ["editor-mutation-disabled"]);
  assert.equal(JSON.stringify(diagnostics).includes("架空"), false);
  state.releaseOperationPolicy();
});

test("categoryHint は未分類 draft の初期カテゴリと属性を種付けする", async () => {
  const state = createState();
  await state.load();
  const registry = createFeatureRegistry();
  assert.equal(registry.register(createRegistration(state)).ok, true);
  const prepared = createActivationRouter({ registry }).prepare({
    featureId,
    target: "open-candidate-editor",
    payload: {
      projectId: prefillProjectId,
      draft: unresolvedNamedDraft,
      categoryHint: "gpu",
    },
  });

  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  assert.equal((await prepared.value.activate()).ok, true);
  assert.equal(state.value.editor?.mode, "create");
  assert.equal(state.value.editor?.draft.category, "gpu");
  assert.deepEqual(state.value.editor?.draft.normalizedAttributes, {
    category: "gpu",
  });
});

test("categoryHint は確定済みカテゴリを上書きしない", async () => {
  const state = createState();
  await state.load();
  const registry = createFeatureRegistry();
  assert.equal(registry.register(createRegistration(state)).ok, true);
  const prepared = createActivationRouter({ registry }).prepare({
    featureId,
    target: "open-candidate-editor",
    payload: {
      projectId: prefillProjectId,
      draft: {
        category: "cpu" as const,
        product: { name: { original: "架空CPU" } },
        normalizedAttributes: {
          category: "cpu" as const,
          socket: { original: "LGA1700" },
        },
      },
      categoryHint: "gpu",
    },
  });

  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  assert.equal((await prepared.value.activate()).ok, true);
  assert.equal(state.value.editor?.draft.category, "cpu");
});

test("不正な categoryHint を含む prefill は拒否され画面を保持する", async () => {
  const state = createState();
  await state.load();
  const registry = createFeatureRegistry();
  assert.equal(registry.register(createRegistration(state)).ok, true);
  const result = createActivationRouter({ registry }).prepare({
    featureId,
    target: "open-candidate-editor",
    payload: {
      projectId: prefillProjectId,
      draft: { ...draft, projectId: prefillProjectId },
      categoryHint: "not-a-category",
    },
  });

  assert.equal(result.ok, false);
  assert.equal(state.value.editor, null);
});

test("current context が利用不能なら存在する project へ fallback せず pending として受理する", async () => {
  const state = createState(projects, currentContext(null).port);
  await state.load();
  const registry = createFeatureRegistry();
  assert.equal(registry.register(createRegistration(state)).ok, true);
  const result = createActivationRouter({ registry }).prepare({
    featureId,
    target: "open-candidate-editor",
    payload: {
      projectId: "10000000-0000-4000-8000-000000000099",
      draft: unresolvedNamedDraft,
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(await result.value.activate(), {
    ok: true,
    value: undefined,
  });
  assert.equal(state.value.editor, null);
  assert.equal(state.value.selectedProjectId, projectId);
  assert.deepEqual(state.value.pendingPreEdit, { draft: unresolvedNamedDraft });
});
