import assert from "node:assert/strict";
import test from "node:test";

import type {
  CandidatePart,
  CandidatePartId,
  CandidateSourceId,
  ProjectId,
  RequestId,
  UtcTimestamp,
  Uuid,
} from "../../../src/domain/public.js";
import type {
  CandidateDraft,
  CandidateQuery,
  CandidateSummary,
  MutationContext,
} from "../../../src/features/candidate-management/contracts.js";
import type { DuplicateCandidateMatcher } from "../../../src/features/candidate-management/duplicate-matcher.js";
import { createDuplicateMergeCoordinator } from "../../../src/features/candidate-management/duplicate-merge.js";
import type { DuplicateUrlRouter } from "../../../src/features/candidate-management/duplicate-url-router.js";

const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const candidateId =
  "30000000-0000-4000-8000-000000000001" as Uuid as CandidatePartId;
const otherCandidateId =
  "30000000-0000-4000-8000-000000000002" as Uuid as CandidatePartId;
const sourceId =
  "40000000-0000-4000-8000-000000000001" as Uuid as CandidateSourceId;
const capturedAt = "2026-07-28T00:00:00.000Z" as UtcTimestamp;
const context: MutationContext = {
  requestId: "50000000-0000-4000-8000-000000000001" as Uuid as RequestId,
  expectedRevision: 7,
};
const draft: CandidateDraft = {
  projectId,
  category: "cpu",
  product: {
    name: { original: "Synthetic Processor" },
    manufacturer: { original: "Example Labs" },
    modelNumber: { original: "EX-100" },
  },
  sources: [
    {
      id: sourceId,
      pageUrl: "https://shop.example.invalid/item/synthetic",
      capturedAt,
      kind: "retail",
      price: {
        original: "123.45 credits",
        confirmed: { amount: 123.45, currency: "XTS" },
      },
    },
  ],
  primarySourceId: sourceId,
  normalizedAttributes: { category: "cpu" },
};
const stored = {
  id: candidateId,
  ...draft,
  createdAt: capturedAt,
  updatedAt: capturedAt,
} as CandidatePart;
const summary: CandidateSummary = {
  id: candidateId,
  projectId,
  category: "cpu",
  name: draft.product.name,
  manufacturer: { original: "Example Labs" },
  modelNumber: { original: "EX-100" },
  hasMissingDetails: false,
  updatedAt: capturedAt,
};
const match = {
  candidateId,
  confidence: "high" as const,
  evidence: { kind: "model-number" as const },
  summary,
};

const query = (
  listCandidates: CandidateQuery["listCandidates"],
): CandidateQuery => ({
  async listProjects() {
    return { ok: true, value: [] };
  },
  listCandidates,
  async listBuildEligible() {
    return { ok: true, value: [] };
  },
  async getCandidateDraft() {
    return { ok: false, error: { kind: "not-found", entity: "candidate" } };
  },
});

test("evaluate queries only the selected project and creates once when no match exists", async () => {
  const calls: string[] = [];
  const coordinator = createDuplicateMergeCoordinator({
    query: query(async (input) => {
      calls.push(`query:${input.projectId}`);
      return { ok: true, value: [] };
    }),
    matcher: {
      match(actualDraft, candidates) {
        calls.push("match");
        assert.equal(actualDraft, draft);
        assert.deepEqual(candidates, []);
        return [];
      },
    },
    createCandidate: async (actualDraft, actualContext) => {
      calls.push("create");
      assert.equal(actualDraft, draft);
      assert.equal(actualContext, context);
      return { ok: true, value: stored };
    },
    router: {
      async route() {
        throw new Error("unexpected route");
      },
    },
  });

  const result = await coordinator.evaluate(draft, context);

  assert.deepEqual(result, {
    ok: true,
    value: { kind: "saved-new", candidate: stored },
  });
  assert.deepEqual(calls, [`query:${projectId}`, "match", "create"]);
});

test("evaluate returns ranked decision without writes when matches exist", async () => {
  let writes = 0;
  const matcher: DuplicateCandidateMatcher = { match: () => [match] };
  const coordinator = createDuplicateMergeCoordinator({
    query: query(async () => ({ ok: true, value: [summary] })),
    matcher,
    createCandidate: async () => {
      writes += 1;
      return { ok: true, value: stored };
    },
    router: {
      async route() {
        writes += 1;
        return { ok: true, value: { kind: "source-added", candidateId } };
      },
    },
  });

  const result = await coordinator.evaluate(draft, context);

  assert.deepEqual(result, {
    ok: true,
    value: { kind: "decision-required", matches: [match] },
  });
  assert.equal(writes, 0);
});

test("complete accepts save-new or one current merge target as exclusive receipts", async () => {
  const calls: string[] = [];
  const router: DuplicateUrlRouter = {
    async route(target, sourceInput) {
      calls.push("route");
      assert.equal(target, candidateId);
      assert.equal(sourceInput.candidateId, candidateId);
      assert.deepEqual(sourceInput.source, draft.sources?.[0]);
      return { ok: true, value: { kind: "source-added", candidateId } };
    },
  };
  const coordinator = createDuplicateMergeCoordinator({
    query: query(async () => ({ ok: true, value: [summary] })),
    matcher: { match: () => [match] },
    createCandidate: async () => {
      calls.push("create");
      return { ok: true, value: stored };
    },
    router,
  });

  assert.deepEqual(
    await coordinator.complete(draft, [match], { kind: "save-new" }, context),
    { ok: true, value: { kind: "saved-new", candidate: stored } },
  );
  assert.deepEqual(
    await coordinator.complete(
      draft,
      [match],
      { kind: "merge", candidateId },
      context,
    ),
    { ok: true, value: { kind: "source-added", candidateId } },
  );
  assert.deepEqual(calls, ["create", "route"]);
});

test("stale target, project contamination and port failures return typed errors without writes", async () => {
  let writes = 0;
  let queryCalls = 0;
  const coordinator = createDuplicateMergeCoordinator({
    query: query(async () => {
      queryCalls += 1;
      return {
        ok: true,
        value:
          queryCalls === 1
            ? [
                {
                  ...summary,
                  projectId:
                    "10000000-0000-4000-8000-000000000099" as Uuid as ProjectId,
                },
              ]
            : [summary],
      };
    }),
    matcher: { match: () => [match] },
    createCandidate: async () => {
      writes += 1;
      return { ok: false, error: { kind: "quota" } };
    },
    router: {
      async route() {
        writes += 1;
        return {
          ok: false,
          error: {
            kind: "source-refresh",
            cause: { kind: "stale-target" },
          },
        };
      },
    },
  });

  assert.deepEqual(await coordinator.evaluate(draft, context), {
    ok: false,
    error: { kind: "management", cause: { kind: "unsupported-data" } },
  });
  assert.equal(writes, 0);
  assert.deepEqual(
    await coordinator.complete(
      draft,
      [match],
      { kind: "merge", candidateId: otherCandidateId },
      context,
    ),
    { ok: false, error: { kind: "stale-decision" } },
  );
  assert.equal(writes, 0);

  assert.deepEqual(
    await coordinator.complete(
      draft,
      [match],
      { kind: "merge", candidateId },
      context,
    ),
    {
      ok: false,
      error: {
        kind: "source-route",
        cause: { kind: "source-refresh", cause: { kind: "stale-target" } },
      },
    },
  );
  assert.equal(writes, 1);
});

test("price refresh receipt passes through without create or source-add receipt", async () => {
  const receipt = {
    candidateId,
    sourceId,
    price: {
      original: "125.00 credits",
      confirmed: { amount: 125, currency: "XTS" },
    },
    capturedAt,
    isPrimary: true,
  } as const;
  let createCalls = 0;
  const coordinator = createDuplicateMergeCoordinator({
    query: query(async () => ({ ok: true, value: [summary] })),
    matcher: { match: () => [match] },
    createCandidate: async () => {
      createCalls += 1;
      return { ok: true, value: stored };
    },
    router: {
      async route() {
        return { ok: true, value: { kind: "price-refreshed", receipt } };
      },
    },
  });

  assert.deepEqual(
    await coordinator.complete(
      draft,
      [match],
      { kind: "merge", candidateId },
      context,
    ),
    { ok: true, value: { kind: "price-refreshed", receipt } },
  );
  assert.equal(createCalls, 0);
});

test("complete re-evaluates the selected target and rejects a stale match before routing", async () => {
  let routeCalls = 0;
  const coordinator = createDuplicateMergeCoordinator({
    query: query(async () => ({ ok: true, value: [summary] })),
    matcher: {
      match() {
        return [];
      },
    },
    createCandidate: async () => ({ ok: true, value: stored }),
    router: {
      async route() {
        routeCalls += 1;
        return { ok: true, value: { kind: "source-added", candidateId } };
      },
    },
  });

  assert.deepEqual(
    await coordinator.complete(
      draft,
      [match],
      { kind: "merge", candidateId },
      context,
    ),
    { ok: false, error: { kind: "stale-decision" } },
  );
  assert.equal(routeCalls, 0);
});

test("query and create failures stay typed and do not enter another write path", async () => {
  let matcherCalls = 0;
  let createCalls = 0;
  let routeCalls = 0;
  const queryFailureCoordinator = createDuplicateMergeCoordinator({
    query: query(async () => ({ ok: false, error: { kind: "storage" } })),
    matcher: {
      match() {
        matcherCalls += 1;
        return [];
      },
    },
    createCandidate: async () => {
      createCalls += 1;
      return { ok: true, value: stored };
    },
    router: {
      async route() {
        routeCalls += 1;
        return { ok: true, value: { kind: "source-added", candidateId } };
      },
    },
  });

  assert.deepEqual(await queryFailureCoordinator.evaluate(draft, context), {
    ok: false,
    error: { kind: "management", cause: { kind: "storage" } },
  });
  assert.deepEqual([matcherCalls, createCalls, routeCalls], [0, 0, 0]);

  const createFailureCoordinator = createDuplicateMergeCoordinator({
    query: query(async () => ({ ok: true, value: [] })),
    matcher: { match: () => [] },
    createCandidate: async () => {
      createCalls += 1;
      return { ok: false, error: { kind: "quota" } };
    },
    router: {
      async route() {
        routeCalls += 1;
        return { ok: true, value: { kind: "source-added", candidateId } };
      },
    },
  });

  assert.deepEqual(await createFailureCoordinator.evaluate(draft, context), {
    ok: false,
    error: { kind: "management", cause: { kind: "quota" } },
  });
  assert.deepEqual([createCalls, routeCalls], [1, 0]);
});
