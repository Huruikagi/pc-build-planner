import assert from "node:assert/strict";
import test from "node:test";

import type {
  CandidatePart,
  ProjectId,
  Uuid,
} from "../../../src/domain/public.js";
import type {
  CandidateQuery,
  CandidateSourceCatalogPort,
  CandidateSourceMutationPort,
} from "../../../src/features/candidate-management/contracts.js";
import { createCandidateManagementPublicApi } from "../../../src/features/candidate-management/public.js";

const projectId = "10000000-0000-4000-8000-000000000071" as Uuid as ProjectId;

test("公開入口はquery・純粋intent factory・sourcesのcanonical exact shapeだけを提供する", async () => {
  const eligible: readonly CandidatePart[] = [];
  const query = {
    async listProjects() {
      return { ok: true as const, value: [] };
    },
    async listCandidates() {
      return { ok: true as const, value: [] };
    },
    async listBuildEligible(receivedProjectId: ProjectId) {
      assert.equal(receivedProjectId, projectId);
      return { ok: true as const, value: eligible };
    },
    async getCandidateDraft() {
      return {
        ok: false as const,
        error: { kind: "not-found" as const, entity: "candidate" as const },
      };
    },
  } satisfies CandidateQuery;
  const api = createCandidateManagementPublicApi({
    query,
    sources: {
      catalog: {
        async listSourceReferences() {
          return { ok: true as const, value: [] };
        },
        async getSourceReference() {
          return {
            ok: false as const,
            error: { kind: "not-found" as const, entity: "source" as const },
          };
        },
      } satisfies CandidateSourceCatalogPort,
      mutations: {
        async addSource() {
          return { ok: true as const, value: undefined };
        },
        async updateSource() {
          return { ok: true as const, value: undefined };
        },
        async removeSource() {
          return { ok: true as const, value: undefined };
        },
        async setPrimarySource() {
          return { ok: true as const, value: undefined };
        },
      } satisfies CandidateSourceMutationPort,
    },
  });

  assert.deepEqual(Object.keys(api).sort(), [
    "createCandidateEditorIntent",
    "query",
    "sources",
  ]);
  assert.equal("capture" in api, false);
  assert.equal("openCandidateEditor" in api, false);

  assert.deepEqual(await api.query.listBuildEligible(projectId), {
    ok: true,
    value: eligible,
  });
});

test("公開入口はmethodを欠くsources facetを合成前に拒否する", () => {
  const query = {} as CandidateQuery;
  assert.throws(
    () =>
      createCandidateManagementPublicApi({
        query,
        sources: {
          catalog: {} as CandidateSourceCatalogPort,
          mutations: {} as CandidateSourceMutationPort,
        },
      }),
    /requires query and sources dependencies/,
  );
});
