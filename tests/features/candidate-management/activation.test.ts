import assert from "node:assert/strict";
import test from "node:test";

import { createFeatureRegistry } from "../../../src/application-shell/feature-registry.js";
import type {
  FeatureId,
  ShellNavigator,
} from "../../../src/application-shell/public.js";
import { createActivationRouter } from "../../../src/application-shell/public.js";
import type { ProjectId, Uuid } from "../../../src/domain/public.js";
import type {
  CandidateManagementService,
  CandidateQuery,
  CaptureCandidatePort,
} from "../../../src/features/candidate-management/contracts.js";
import { createCandidateFeatureRegistration } from "../../../src/features/candidate-management/registration.js";
import { createManagementState } from "../../../src/features/candidate-management/state.js";
import type { FoundationDataPort } from "../../../src/persistence/public.js";

const featureId = "candidate-management" as FeatureId;
const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const prefillProjectId =
  "10000000-0000-4000-8000-000000000002" as Uuid as ProjectId;
const draft = {
  projectId,
  category: "uncategorized" as const,
  product: { name: { original: "架空の候補" } },
  normalizedAttributes: { category: "uncategorized" as const },
};

const createState = () =>
  createManagementState({
    query: {
      async listProjects() {
        return {
          ok: true as const,
          value: [
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
    capture: {} as CaptureCandidatePort,
    state,
  });

test("候補編集公開 API は型付き prefill を candidate-management activation intent として navigator へ渡す", async () => {
  const received: unknown[] = [];
  const navigator: ShellNavigator = {
    async activate(intent) {
      received.push(intent);
      return { ok: true, value: undefined };
    },
  };
  const api = createCandidateFeatureRegistration({
    data: {} as FoundationDataPort,
    query: {} as CandidateQuery,
    capture: {} as CaptureCandidatePort,
    navigator,
  }).publicApi;

  assert.deepEqual(await api.openCandidateEditor({ projectId, draft }), {
    ok: true,
    value: undefined,
  });
  assert.deepEqual(received, [
    {
      featureId,
      target: "open-candidate-editor",
      payload: { projectId, draft },
    },
  ]);
});

test("activation は正常 prefill を一度だけ詳細編集へ適用し、不正な受信内容では既存画面を保持する", async () => {
  const state = createState();
  const prefill = { ...draft, projectId: prefillProjectId };
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
    payload: { projectId: prefillProjectId, draft: prefill },
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
  });
  assert.equal((await prepared.value.activate()).ok, false);
});

test("mutation が禁止された状態の activation は編集画面を開かず失敗を返す", async () => {
  const state = createState();
  await state.load();
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
      draft: { ...draft, projectId: prefillProjectId },
    },
  });

  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  assert.deepEqual(await prepared.value.activate(), {
    ok: false,
    error: {
      kind: "activation_failed",
      detail: "candidate editor could not be opened",
    },
  });
  assert.equal(state.value.editor, null);
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
      draft: { ...draft, projectId: prefillProjectId },
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
        projectId: prefillProjectId,
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

test("存在しない project を指定した activation は draft を変更しない", async () => {
  const state = createState();
  await state.load();
  const registry = createFeatureRegistry();
  assert.equal(registry.register(createRegistration(state)).ok, true);
  const result = createActivationRouter({ registry }).prepare({
    featureId,
    target: "open-candidate-editor",
    payload: {
      projectId: "10000000-0000-4000-8000-000000000099",
      draft: {
        ...draft,
        projectId: "10000000-0000-4000-8000-000000000099",
      },
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(await result.value.activate(), {
    ok: false,
    error: { kind: "activation_failed", detail: "project does not exist" },
  });
  assert.equal(state.value.editor, null);
});
