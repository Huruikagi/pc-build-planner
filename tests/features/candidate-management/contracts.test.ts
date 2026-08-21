import assert from "node:assert/strict";
import test from "node:test";
import type {
  CandidateDraft,
  CandidateEditorPrefill,
  CandidateOperationError,
  CandidateSourceCatalogPort,
  CandidateSourceMutationPort,
  CandidateSummary,
} from "../../../src/features/candidate-management/public.js";
import {
  type CandidateManagementPublicDependencies,
  type CandidateQuery,
  createCandidateManagementPublicApi,
} from "../../../src/features/candidate-management/public.js";

const sources = {
  catalog: {
    async listSourceReferences() {
      return { ok: true as const, value: [] };
    },
    async getSourceReference() {
      return {
        ok: false as const,
        error: {
          code: "validation" as const,
          reason: "entity-not-found" as const,
          message: "source",
        },
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
    async patchSourcePrice() {
      return { ok: true as const, value: undefined };
    },
    async removeSource() {
      return { ok: true as const, value: undefined };
    },
    async setPrimarySource() {
      return { ok: true as const, value: undefined };
    },
  } satisfies CandidateSourceMutationPort,
};

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

const create = {
  async createCandidate() {
    throw new Error("not used by contract shape tests");
  },
};

test("公開入口はcanonical query・intent・sources facetを公開する", () => {
  const api = createCandidateManagementPublicApi({
    query,
    create,
    sources,
  });

  assert.equal(api.query, query);
  assert.equal(api.sources.catalog, sources.catalog);
  assert.equal(api.sources.mutations, sources.mutations);
  assert.equal("capture" in api, false);
  assert.equal(Object.isFrozen(api), true);
});

test("公開入口はtyped editor intentを生成する", () => {
  const api = createCandidateManagementPublicApi({
    query,
    create,
    sources,
  });
  const prefill = {
    draft: {
      category: "uncategorized",
      product: { name: { original: null, confirmed: "" } },
      normalizedAttributes: { category: "uncategorized" },
    },
  } satisfies CandidateEditorPrefill;
  const first = api.createCandidateEditorIntent(prefill);
  const second = api.createCandidateEditorIntent(prefill);
  assert.deepEqual(first, {
    featureId: "candidate-management",
    target: "open-candidate-editor",
    payload: prefill,
  });
  assert.deepEqual(second, first);
  assert.equal(first.payload, prefill);
  assert.equal(api.query, query);
  assert.equal(api.sources.catalog, sources.catalog);
  assert.equal(api.sources.mutations, sources.mutations);
});

test("公開入口は照会とsources契約がなければ組み立てを拒否する", () => {
  assert.throws(
    () =>
      createCandidateManagementPublicApi({
        query: {} as CandidateQuery,
      } as CandidateManagementPublicDependencies),
    /query, create, and sources/,
  );
});

test("複数sourceのdraft・summary・公開portを型付きで表現する", () => {
  const draft = {
    projectId: "10000000-0000-4000-8000-000000000001",
    category: "uncategorized",
    product: { name: { original: "架空の候補パーツ" } },
    normalizedAttributes: { category: "uncategorized" },
    sources: [],
  } as unknown as CandidateDraft;
  const summary = {
    id: "20000000-0000-4000-8000-000000000001",
    projectId: draft.projectId,
    category: draft.category,
    name: draft.product.name,
    hasMissingDetails: true,
    updatedAt: "2026-07-28T00:00:00.000Z",
  } as CandidateSummary;
  const catalog = {} as CandidateSourceCatalogPort;
  const mutations = {} as CandidateSourceMutationPort;
  const missing: CandidateOperationError = {
    code: "validation",
    reason: "entity-not-found",
    message: "source",
  };

  assert.deepEqual(draft.sources, []);
  assert.equal(summary.primarySource, undefined);
  assert.equal(summary.price, undefined);
  assert.equal(typeof catalog, "object");
  assert.equal(typeof mutations, "object");
  assert.equal(missing.code, "validation");
  if (missing.code === "validation")
    assert.equal(missing.reason, "entity-not-found");
});
