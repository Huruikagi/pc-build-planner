import assert from "node:assert/strict";
import test from "node:test";

import type {
  ProjectId,
  UtcTimestamp,
  Uuid,
} from "../../../src/domain/public.js";
import {
  acceptCandidatePreEdit,
  createCandidateActivation,
  createCandidateEditorIntent,
} from "../../../src/features/candidate-management/activation.js";
import type {
  CandidateManagementQuery,
  CandidateManagementService,
  CurrentProjectPort,
  UnresolvedCandidateEditorPrefill,
} from "../../../src/features/candidate-management/contracts.js";
import { createManagementState } from "../../../src/features/candidate-management/state.js";

const currentProjectId =
  "10000000-0000-4000-8000-000000000031" as Uuid as ProjectId;
const otherProjectId =
  "10000000-0000-4000-8000-000000000032" as Uuid as ProjectId;
const stalePayloadProjectId = "10000000-0000-4000-8000-000000000099";
const timestamp = "2026-08-10T00:00:00.000Z" as UtcTimestamp;

/**
 * The catalog head is deliberately a different project from the current one,
 * so any fallback to `projects[0]` shows up as a wrong save target.
 */
const projects = [
  { id: otherProjectId, name: "catalog head", updatedAt: timestamp },
  { id: currentProjectId, name: "current", updatedAt: timestamp },
] as const;

const prefill: UnresolvedCandidateEditorPrefill = {
  draft: {
    category: "uncategorized",
    product: { name: { original: "架空の未解決候補" } },
    normalizedAttributes: { category: "uncategorized" },
  },
};

const query: CandidateManagementQuery = {
  async listProjects() {
    return { ok: true, value: projects };
  },
  async listCandidates() {
    return { ok: true, value: [] };
  },
  async listBuildEligible() {
    return { ok: true, value: [] };
  },
  async getCandidateDraft() {
    return {
      ok: false,
      error: { kind: "not-found", entity: "candidate" },
    };
  },
};

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
    change(next: ProjectId | null) {
      current = next;
      for (const listener of listeners) listener();
    },
  };
};

const createState = (currentProject: CurrentProjectPort) =>
  createManagementState({
    query,
    service: {} as CandidateManagementService,
    createMutationContext: () => {
      throw new Error("not used");
    },
    currentProject,
  });

test("検証済み current project がある受理は bound として project を確定する", async () => {
  const state = createState(currentContext(currentProjectId).port);
  await state.load();
  // A stale screen selection must not decide the save target.
  await state.selectProject(otherProjectId);

  const accepted = await acceptCandidatePreEdit(state, prefill);

  assert.deepEqual(accepted, {
    ok: true,
    value: { kind: "bound", projectId: currentProjectId },
  });
  assert.equal(state.value.editor?.draft.projectId, currentProjectId);
  assert.equal(state.value.pendingPreEdit, null);
});

test("current context 未選択の受理は pending として保持し catalog 先頭へ fallback しない", async () => {
  const state = createState(currentContext(null).port);
  await state.load();

  const accepted = await acceptCandidatePreEdit(state, prefill);

  assert.deepEqual(accepted, { ok: true, value: { kind: "pending" } });
  assert.equal(state.value.editor, null);
  assert.deepEqual(state.value.pendingPreEdit, prefill);
});

test("current context が利用不能な場合も error ではなく pending 受理になる", async () => {
  const unavailable: CurrentProjectPort = {
    getCurrentProject() {
      throw new Error("project context is unavailable");
    },
    subscribe: () => () => {},
  };
  const state = createState(unavailable);
  await state.load();

  const accepted = await acceptCandidatePreEdit(state, prefill);

  assert.deepEqual(accepted, { ok: true, value: { kind: "pending" } });
  assert.deepEqual(state.value.pendingPreEdit, prefill);
});

test("stale な payload project は bound でも pending でも保存先に現れない", async () => {
  const bound = createState(currentContext(currentProjectId).port);
  await bound.load();
  const boundActivation = createCandidateActivation(bound);
  const boundIntent = boundActivation.validate(
    createCandidateEditorIntent({
      ...prefill,
      projectId: stalePayloadProjectId,
    } as UnresolvedCandidateEditorPrefill),
  );
  assert.equal(boundIntent.ok, true);
  if (!boundIntent.ok) return;
  assert.equal((await boundActivation.activate(boundIntent.value)).ok, true);
  assert.equal(bound.value.editor?.draft.projectId, currentProjectId);
  assert.equal(
    JSON.stringify(bound.value.editor).includes(stalePayloadProjectId),
    false,
  );

  const pending = createState(currentContext(null).port);
  await pending.load();
  const pendingActivation = createCandidateActivation(pending);
  const pendingIntent = pendingActivation.validate(
    createCandidateEditorIntent({
      ...prefill,
      projectId: stalePayloadProjectId,
    } as UnresolvedCandidateEditorPrefill),
  );
  assert.equal(pendingIntent.ok, true);
  if (!pendingIntent.ok) return;
  assert.equal(
    (await pendingActivation.activate(pendingIntent.value)).ok,
    true,
  );
  assert.deepEqual(pending.value.pendingPreEdit, prefill);
  assert.equal(
    JSON.stringify(pending.value.pendingPreEdit).includes(
      stalePayloadProjectId,
    ),
    false,
  );
});

test("受理済み project は後続の current context 変更で置き換えられない", async () => {
  const context = currentContext(currentProjectId);
  const state = createState(context.port);
  await state.load();
  state.attachCurrentProject();

  assert.deepEqual(await acceptCandidatePreEdit(state, prefill), {
    ok: true,
    value: { kind: "bound", projectId: currentProjectId },
  });

  context.change(otherProjectId);
  assert.equal(state.value.editor?.projectId, currentProjectId);
  assert.equal(state.value.editor?.draft.projectId, currentProjectId);

  context.change(null);
  assert.equal(state.value.editor?.projectId, currentProjectId);
  assert.equal(state.value.pendingPreEdit, null);
  state.releaseCurrentProject();
});
