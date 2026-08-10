import assert from "node:assert/strict";
import test from "node:test";

import type {
  ProjectId,
  UtcTimestamp,
  Uuid,
} from "../../../src/domain/public.js";
import type {
  CandidateManagementQuery,
  CandidateManagementService,
  CurrentProjectPort,
  UnresolvedCandidateEditorPrefill,
} from "../../../src/features/candidate-management/contracts.js";
import { createManagementState } from "../../../src/features/candidate-management/state.js";

const projectId = "10000000-0000-4000-8000-000000000071" as Uuid as ProjectId;
const timestamp = "2026-08-10T00:00:00.000Z" as UtcTimestamp;
const pending: UnresolvedCandidateEditorPrefill = {
  draft: {
    category: "uncategorized",
    product: { name: { original: "架空の回復待ち候補" } },
    normalizedAttributes: { category: "uncategorized" },
  },
};

const query: CandidateManagementQuery = {
  async listProjects() {
    return {
      ok: true,
      value: [{ id: projectId, name: "架空", updatedAt: timestamp }],
    };
  },
  async listCandidates() {
    return { ok: true, value: [] };
  },
  async listBuildEligible() {
    return { ok: true, value: [] };
  },
  async getCandidateDraft() {
    return { ok: false, error: { kind: "not-found", entity: "candidate" } };
  },
};

test("project作成後のrefresh失敗はdraftを保持し、回復操作はmutationを再送しない", async () => {
  let creates = 0;
  let refreshes = 0;
  let current: ProjectId | null = null;
  const currentProject: CurrentProjectPort = {
    getCurrentProject: () =>
      current === null
        ? { status: "unresolved" }
        : { status: "resolved", projectId: current },
    subscribe: () => () => {},
    async refresh() {
      refreshes += 1;
      if (refreshes === 1)
        return { ok: false, error: { kind: "context-unavailable" } };
      current = projectId;
      return { ok: true, value: { status: "resolved", projectId } };
    },
  };
  const service = {
    async createProject() {
      creates += 1;
      return {
        ok: true as const,
        value: {
          id: projectId,
          name: "架空",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      };
    },
  } as unknown as CandidateManagementService;
  const state = createManagementState({
    query,
    service,
    currentProject,
    createMutationContext: () => ({
      requestId: "20000000-0000-4000-8000-000000000071" as never,
      expectedRevision: 0 as never,
    }),
  });
  state.holdPendingPreEdit(pending);

  await state.createProject("架空");
  assert.equal(creates, 1);
  assert.equal(refreshes, 1);
  assert.deepEqual(state.value.pendingPreEdit, pending);
  assert.deepEqual(state.value.displayError, {
    code: "context-refresh-failed",
  });

  await state.retryContextRefresh();
  assert.equal(creates, 1);
  assert.equal(refreshes, 2);
  assert.equal(state.value.pendingPreEdit, null);
  assert.equal(state.value.editor?.projectId, projectId);
});
