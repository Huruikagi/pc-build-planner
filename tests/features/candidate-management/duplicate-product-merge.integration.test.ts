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
  ManagementError,
  MutationContext,
} from "../../../src/features/candidate-management/contracts.js";
import { createDuplicateCandidateMatcher } from "../../../src/features/candidate-management/duplicate-matcher.js";
import { createDuplicateMergeCoordinator } from "../../../src/features/candidate-management/duplicate-merge.js";
import { createDuplicateMergeState } from "../../../src/features/candidate-management/duplicate-merge-state.js";
import { createDuplicateUrlRouter } from "../../../src/features/candidate-management/duplicate-url-router.js";
import type { CandidateSourceMutationPort } from "../../../src/features/candidate-management/public.js";
import { createProductIdentityNormalizer } from "../../../src/features/product-capture/public.js";
import type {
  SourcePriceRefreshError,
  SourcePriceRefreshPort,
} from "../../../src/features/source-price-refresh/public.js";

const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const candidateId =
  "30000000-0000-4000-8000-000000000001" as Uuid as CandidatePartId;
const oldSourceId =
  "40000000-0000-4000-8000-000000000001" as Uuid as CandidateSourceId;
const newSourceId =
  "40000000-0000-4000-8000-000000000002" as Uuid as CandidateSourceId;
const capturedAt = "2026-08-01T00:00:00.000Z" as UtcTimestamp;
const oldUrl = "https://manufacturer.example.invalid/syn-cpu";
const newUrl = "https://retailer.example.invalid/syn-cpu";
const context: MutationContext = {
  requestId: "50000000-0000-4000-8000-000000000001" as Uuid as RequestId,
  expectedRevision: 1,
};

const existingDraft: CandidateDraft = {
  projectId,
  category: "cpu",
  product: {
    name: { original: "SYN Processor" },
    manufacturer: { original: "SYN Labs" },
    modelNumber: { original: "SYN-100" },
    notes: { original: "confirmed existing note" },
  },
  normalizedAttributes: { category: "cpu", socket: { original: "SYN-S1" } },
  sources: [
    { id: oldSourceId, pageUrl: oldUrl, kind: "manufacturer", capturedAt },
  ],
  primarySourceId: oldSourceId,
};

const incoming = (pageUrl = newUrl): CandidateDraft => ({
  projectId,
  category: "cpu",
  product: {
    name: { original: "incoming value must not replace product" },
    manufacturer: { original: "other incoming maker" },
    modelNumber: { original: "ＳＹＮ ＿ １００" },
  },
  normalizedAttributes: { category: "cpu", socket: { original: "OTHER" } },
  sources: [
    {
      id: newSourceId,
      pageUrl,
      siteName: "SYN retailer",
      kind: "retail",
      capturedAt,
      price: {
        original: "123 credits",
        confirmed: { amount: 123, currency: "XTS" },
      },
    },
  ],
  primarySourceId: newSourceId,
});

const summaryOf = (candidate: CandidatePart): CandidateSummary => {
  const primarySource = candidate.sources?.find(
    (source) => source.id === candidate.primarySourceId,
  );
  return {
    id: candidate.id,
    projectId: candidate.projectId,
    category: candidate.category,
    name: candidate.product.name ?? { original: "" },
    ...(candidate.product.manufacturer === undefined
      ? {}
      : { manufacturer: candidate.product.manufacturer }),
    ...(candidate.product.modelNumber === undefined
      ? {}
      : { modelNumber: candidate.product.modelNumber }),
    ...(primarySource === undefined ? {} : { primarySource }),
    hasMissingDetails: false,
    updatedAt: candidate.updatedAt,
  };
};

interface HarnessOptions {
  readonly queryError?: ManagementError;
  readonly createError?: ManagementError;
  readonly addError?: ManagementError;
  readonly matchError?: SourcePriceRefreshError;
  readonly refreshError?: SourcePriceRefreshError;
}

function createHarness(options: HarnessOptions = {}) {
  let stored: CandidatePart[] = [
    {
      id: candidateId,
      ...existingDraft,
      createdAt: capturedAt,
      updatedAt: capturedAt,
    } as CandidatePart,
  ];
  let createCalls = 0;
  let addCalls = 0;
  let refreshCalls = 0;
  let committed = 0;
  const query: CandidateQuery = {
    async listProjects() {
      return { ok: true, value: [] };
    },
    async listCandidates(input) {
      if (options.queryError !== undefined)
        return { ok: false, error: options.queryError };
      return {
        ok: true,
        value: stored
          .filter((item) => item.projectId === input.projectId)
          .map(summaryOf),
      };
    },
    async listBuildEligible() {
      return { ok: true, value: [] };
    },
    async getCandidateDraft() {
      return { ok: false, error: { kind: "not-found", entity: "candidate" } };
    },
  };
  const sourceMutations: CandidateSourceMutationPort = {
    async addSource(input) {
      addCalls += 1;
      if (options.addError !== undefined)
        return { ok: false, error: options.addError };
      stored = stored.map((item) =>
        item.id === input.candidateId
          ? ({
              ...item,
              sources: [...(item.sources ?? []), input.source],
            } as CandidatePart)
          : item,
      );
      return { ok: true, value: undefined };
    },
    async updateSource() {
      throw new Error("unexpected update");
    },
    async patchSourcePrice() {
      throw new Error("unexpected patch");
    },
    async removeSource() {
      throw new Error("unexpected remove");
    },
    async setPrimarySource() {
      throw new Error("unexpected primary change");
    },
  };
  const refresh: SourcePriceRefreshPort = {
    async matchSource(input) {
      if (options.matchError !== undefined)
        return { ok: false, error: options.matchError };
      const scope = input.scope;
      assert.equal(scope.kind, "candidate");
      if (scope.kind !== "candidate")
        return { ok: false, error: { kind: "no-match" } };
      const candidate = stored.find((item) => item.id === scope.candidateId);
      const source = candidate?.sources?.find(
        (item) => item.pageUrl === input.pageUrl,
      );
      return source === undefined
        ? { ok: false, error: { kind: "no-match" } }
        : {
            ok: true,
            value: {
              candidateId: candidateId,
              sourceId: source.id,
              normalizedPageUrl: source.pageUrl as never,
              isPrimary: source.id === candidate?.primarySourceId,
            },
          };
    },
    async refreshCapturedPrice(input) {
      refreshCalls += 1;
      if (options.refreshError !== undefined)
        return { ok: false, error: options.refreshError };
      assert.ok(input.price);
      return {
        ok: true,
        value: {
          candidateId: input.target.candidateId,
          sourceId: input.target.sourceId,
          price: input.price,
          capturedAt: input.capturedAt,
          isPrimary: input.target.sourceId === oldSourceId,
        },
      };
    },
  };
  const coordinator = createDuplicateMergeCoordinator({
    query,
    matcher: createDuplicateCandidateMatcher(createProductIdentityNormalizer()),
    router: createDuplicateUrlRouter({ refresh, sourceMutations }),
    async createCandidate(draft) {
      createCalls += 1;
      if (options.createError !== undefined)
        return { ok: false, error: options.createError };
      const created = {
        id: `30000000-0000-4000-8000-${String(stored.length + 1).padStart(12, "0")}` as Uuid as CandidatePartId,
        ...draft,
        createdAt: capturedAt,
        updatedAt: capturedAt,
      } as CandidatePart;
      stored = [...stored, created];
      return { ok: true, value: created };
    },
  });
  const state = createDuplicateMergeState({
    coordinator,
    createMutationContext: () => context,
    onCommitted: () => {
      committed += 1;
    },
  });
  return {
    state,
    get stored() {
      return stored;
    },
    get calls() {
      return { createCalls, addCalls, refreshCalls, committed };
    },
    removeTarget() {
      stored = [];
    },
  };
}

test("public-port integration adds one source atomically and preserves candidate product, attributes and primary", async () => {
  const harness = createHarness();
  const before = structuredClone(harness.stored[0]);
  await harness.state.evaluate(incoming());
  assert.equal(harness.state.value.status, "deciding");
  harness.state.selectCandidate(candidateId);
  await harness.state.mergeSelected();
  assert.deepEqual(harness.calls, {
    createCalls: 0,
    addCalls: 1,
    refreshCalls: 0,
    committed: 1,
  });
  assert.equal(harness.stored.length, 1);
  assert.equal(harness.stored[0]?.sources?.length, 2);
  assert.deepEqual(harness.stored[0]?.product, before?.product);
  assert.deepEqual(
    harness.stored[0]?.normalizedAttributes,
    before?.normalizedAttributes,
  );
  assert.equal(harness.stored[0]?.primarySourceId, oldSourceId);
});

test("same URL routes only to price refresh and a removed target makes the decision stale without writes", async () => {
  const refreshed = createHarness();
  await refreshed.state.evaluate(incoming(oldUrl));
  refreshed.state.selectCandidate(candidateId);
  await refreshed.state.mergeSelected();
  assert.deepEqual(refreshed.calls, {
    createCalls: 0,
    addCalls: 0,
    refreshCalls: 1,
    committed: 1,
  });
  assert.equal(refreshed.stored[0]?.sources?.length, 1);

  const stale = createHarness();
  await stale.state.evaluate(incoming());
  stale.state.selectCandidate(candidateId);
  stale.removeTarget();
  await stale.state.mergeSelected();
  assert.equal(stale.state.value.status, "failed");
  assert.deepEqual(stale.calls, {
    createCalls: 0,
    addCalls: 0,
    refreshCalls: 0,
    committed: 0,
  });
});

test("matchなしと明示新規保存はcreateだけを一度実行する", async () => {
  const noMatch = createHarness();
  await noMatch.state.evaluate({
    ...incoming(),
    product: { ...incoming().product, modelNumber: { original: "UNIQUE-999" } },
  });
  assert.deepEqual(noMatch.calls, {
    createCalls: 1,
    addCalls: 0,
    refreshCalls: 0,
    committed: 1,
  });

  const explicit = createHarness();
  await explicit.state.evaluate(incoming());
  await explicit.state.saveNew();
  assert.deepEqual(explicit.calls, {
    createCalls: 1,
    addCalls: 0,
    refreshCalls: 0,
    committed: 1,
  });
});

test("query・管理・URL照合・価格欠損の全失敗でdraft、match、既存candidateを保持する", async () => {
  const queryFailures: readonly ManagementError[] = [
    { kind: "conflict" },
    { kind: "maintenance" },
    { kind: "storage" },
    { kind: "quota" },
  ];
  for (const queryError of queryFailures) {
    const harness = createHarness({ queryError });
    const before = structuredClone(harness.stored);
    const draft = incoming();
    await harness.state.evaluate(draft);
    assert.equal(harness.state.value.status, "failed");
    assert.equal(
      harness.state.value.status === "failed" && harness.state.value.draft,
      draft,
    );
    assert.deepEqual(harness.stored, before);
    assert.deepEqual(harness.calls, {
      createCalls: 0,
      addCalls: 0,
      refreshCalls: 0,
      committed: 0,
    });
  }

  const managementFailures: readonly ManagementError[] = [
    { kind: "validation", fields: { source: "invalid-source" } },
    { kind: "conflict" },
    { kind: "maintenance" },
    { kind: "storage" },
    { kind: "quota" },
  ];
  for (const addError of managementFailures) {
    const harness = createHarness({ addError });
    const before = structuredClone(harness.stored);
    const draft = incoming();
    await harness.state.evaluate(draft);
    harness.state.selectCandidate(candidateId);
    await harness.state.mergeSelected();
    assert.equal(harness.state.value.status, "failed");
    assert.equal(
      harness.state.value.status === "failed" && harness.state.value.draft,
      draft,
    );
    assert.equal(
      harness.state.value.status === "failed" &&
        harness.state.value.matches.length,
      1,
    );
    assert.deepEqual(harness.stored, before);
    assert.deepEqual(harness.calls, {
      createCalls: 0,
      addCalls: 1,
      refreshCalls: 0,
      committed: 0,
    });
  }

  for (const matchError of [
    { kind: "ambiguous-match" },
    { kind: "stale-target" },
  ] as const) {
    const harness = createHarness({ matchError });
    const before = structuredClone(harness.stored);
    await harness.state.evaluate(incoming());
    harness.state.selectCandidate(candidateId);
    await harness.state.mergeSelected();
    assert.equal(harness.state.value.status, "failed");
    assert.deepEqual(harness.stored, before);
    assert.deepEqual(harness.calls, {
      createCalls: 0,
      addCalls: 0,
      refreshCalls: 0,
      committed: 0,
    });
  }

  const noPrice = createHarness();
  const priceMissing = {
    ...incoming(oldUrl),
    sources: incoming(oldUrl).sources?.map(
      ({ price: _price, ...source }) => source,
    ),
  } as CandidateDraft;
  await noPrice.state.evaluate(priceMissing);
  noPrice.state.selectCandidate(candidateId);
  await noPrice.state.mergeSelected();
  assert.equal(noPrice.state.value.status, "failed");
  assert.deepEqual(noPrice.calls, {
    createCalls: 0,
    addCalls: 0,
    refreshCalls: 0,
    committed: 0,
  });
});

test("同じmerge判断の二重送信はsourceを一件だけ追加し機微情報をconsoleへ出さない", async () => {
  const logged: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => logged.push(args);
  try {
    const success = createHarness();
    await success.state.evaluate(incoming());
    success.state.selectCandidate(candidateId);
    await Promise.all([
      success.state.mergeSelected(),
      success.state.mergeSelected(),
    ]);
    assert.equal(success.stored[0]?.sources?.length, 2);
    assert.equal(success.calls.addCalls, 1);

    const failure = createHarness({ queryError: { kind: "storage" } });
    await failure.state.evaluate(incoming());
    assert.equal(failure.state.value.status, "failed");
    assert.deepEqual(logged, []);
    assert.doesNotMatch(
      JSON.stringify(logged),
      /SYN-100|retailer\.example\.invalid|incoming value must not replace product/,
    );
  } finally {
    console.error = originalError;
  }
});
