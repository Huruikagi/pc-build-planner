import assert from "node:assert/strict";
import test from "node:test";
import type {
  CandidateDraft,
  CandidateEditorPrefill,
  CandidateSourceCatalogPort,
  CandidateSourceMutationPort,
  CandidateSummary,
  ManagementError,
} from "../../../src/features/candidate-management/public.js";
import {
  type CandidateManagementPublicDependencies,
  type CandidateQuery,
  createCandidateManagementPublicApi,
} from "../../../src/features/candidate-management/public.js";

const sources = {
  catalog: {} as CandidateSourceCatalogPort,
  mutations: {} as CandidateSourceMutationPort,
};

test("公開入口はcanonical query・intent・sources facetを公開する", () => {
  const query = {} as CandidateQuery;
  const api = createCandidateManagementPublicApi({
    query,
    sources,
  });

  assert.equal(api.query, query);
  assert.equal(api.sources.catalog, sources.catalog);
  assert.equal(api.sources.mutations, sources.mutations);
  assert.equal("capture" in api, false);
  assert.equal(Object.isFrozen(api), true);
});

test("公開入口はtyped editor intentを生成する", () => {
  const query = {} as CandidateQuery;
  const api = createCandidateManagementPublicApi({
    query,
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
    /query and sources/,
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
  const missing: ManagementError = { kind: "not-found", entity: "source" };

  assert.deepEqual(draft.sources, []);
  assert.equal(summary.primarySource, undefined);
  assert.equal(summary.price, undefined);
  assert.equal(typeof catalog, "object");
  assert.equal(typeof mutations, "object");
  assert.equal(missing.entity, "source");
});
