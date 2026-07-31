import assert from "node:assert/strict";
import test from "node:test";
import type {
  TransientGestureRegistrationPort,
  TransientGestureSource,
} from "../../src/application-shell/public.js";
import type {
  CandidatePartId,
  CandidateSourceId,
  MoneyValue,
  SourcedValue,
  UtcTimestamp,
} from "../../src/domain/public.js";
import type {
  CandidateSourceCatalogPort,
  CandidateSourceMutationPort,
} from "../../src/features/candidate-management/public.js";
import type { PagePriceExtractionPort } from "../../src/features/product-capture/public.js";
import {
  catalogSourceMatchScope,
  type MatchedCandidateSource,
  type MatchStoredSourceInput,
  type NormalizedSourcePageUrl,
  type RefreshCapturedPriceInput,
  type SourcePriceRefreshError,
  type SourcePriceRefreshPort,
  type SourcePriceRefreshPublicApi,
  sourcePriceRefreshFeatureId,
} from "../../src/features/source-price-refresh/public.js";
import {
  createSourcePriceRefreshPublicConsumer,
  isSameStoredSourcePage,
  normalizedCatalogRequest,
  refreshThroughPublicApi,
  type SourcePriceRefreshConsumerPorts,
  sourcePriceRefreshRecovery,
} from "./source-price-refresh-public-consumer.js";

const candidateId = "60000000-0000-4000-8000-000000000001" as CandidatePartId;

const consumerPorts = (
  registered: TransientGestureSource[],
): SourcePriceRefreshConsumerPorts => {
  const catalog: CandidateSourceCatalogPort = {
    async listSourceReferences() {
      return { ok: true, value: [] };
    },
    async getSourceReference() {
      return { ok: false, error: { kind: "not-found", entity: "source" } };
    },
  };
  const mutations: CandidateSourceMutationPort = {
    async addSource() {
      return { ok: true, value: undefined };
    },
    async updateSource() {
      return { ok: true, value: undefined };
    },
    async removeSource() {
      return { ok: true, value: undefined };
    },
    async setPrimarySource() {
      return { ok: true, value: undefined };
    },
  };
  const pagePriceExtraction: PagePriceExtractionPort = {
    async extractPrice() {
      return { ok: false, error: { kind: "restricted-page" } };
    },
  };
  const gestures: TransientGestureRegistrationPort = {
    register(source) {
      registered.push(source);
      return { ok: true, value: () => {} };
    },
  };
  return { catalog, mutations, pagePriceExtraction, gestures };
};

test("公開consumerは4つの上流portを公開入口だけで組み立てる", () => {
  const registered: TransientGestureSource[] = [];
  const consumer = createSourcePriceRefreshPublicConsumer(
    consumerPorts(registered),
  );
  assert.deepEqual(Object.keys(consumer.ports).toSorted(), [
    "catalog",
    "gestures",
    "mutations",
    "pagePriceExtraction",
  ]);

  const source: TransientGestureSource = {
    id: "source-price-refresh",
    surfaceId: sourcePriceRefreshFeatureId,
    start: () => ({ ok: true, value: () => {} }),
  };
  assert.deepEqual(consumer.registerGesture(source).ok, true);
  assert.deepEqual(registered, [source]);
});

const sourceId = "60000000-0000-4000-8000-000000000002" as CandidateSourceId;
const normalizedPageUrl =
  "https://prices.example.invalid/products/synthetic-part" as NormalizedSourcePageUrl;
const capturedAt = "2026-07-31T00:00:00.000Z" as UtcTimestamp;
const price: SourcedValue<MoneyValue> = {
  original: "￥12,800",
  confirmed: { amount: 12800, currency: "JPY" },
};

const matched: MatchedCandidateSource = {
  candidateId,
  sourceId,
  normalizedPageUrl,
  isPrimary: true,
};

interface RefreshCall {
  readonly matchInputs: MatchStoredSourceInput[];
  readonly refreshInputs: RefreshCapturedPriceInput[];
}

const refreshApi = (
  calls: RefreshCall,
  outcome:
    | { readonly kind: "match-failed"; readonly error: SourcePriceRefreshError }
    | {
        readonly kind: "refresh-failed";
        readonly error: SourcePriceRefreshError;
      }
    | { readonly kind: "refreshed" },
): SourcePriceRefreshPublicApi => {
  const refresh: SourcePriceRefreshPort = {
    async matchSource(input) {
      calls.matchInputs.push(input);
      return outcome.kind === "match-failed"
        ? { ok: false, error: outcome.error }
        : { ok: true, value: matched };
    },
    async refreshCapturedPrice(input) {
      calls.refreshInputs.push(input);
      return outcome.kind === "refresh-failed"
        ? { ok: false, error: outcome.error }
        : {
            ok: true,
            value: {
              candidateId: input.target.candidateId,
              sourceId: input.target.sourceId,
              price,
              capturedAt: input.capturedAt,
              isPrimary: true,
            },
          };
    },
  };
  return { refresh };
};

test("公開APIのmatch結果からreceiptまでを公開契約だけで往復する", async () => {
  const calls: RefreshCall = { matchInputs: [], refreshInputs: [] };
  const request: MatchStoredSourceInput = {
    scope: catalogSourceMatchScope(),
    pageUrl:
      "https://prices.example.invalid/products/synthetic-part?utm_source=x",
  };
  const outcome = await refreshThroughPublicApi(
    refreshApi(calls, { kind: "refreshed" }),
    request,
    { capturedAt, price },
  );

  assert.deepEqual(calls.matchInputs, [request]);
  assert.deepEqual(calls.refreshInputs, [
    {
      target: { candidateId, sourceId },
      observedPageUrl: normalizedPageUrl,
      capturedAt,
      price,
    },
  ]);
  assert.deepEqual(outcome, {
    kind: "refreshed",
    matchedPageUrl: normalizedPageUrl,
    receipt: { candidateId, sourceId, price, capturedAt, isPrimary: true },
  });
});

test("価格欠損の観測はmutation入力へprice fieldを持ち込まない", async () => {
  const calls: RefreshCall = { matchInputs: [], refreshInputs: [] };
  await refreshThroughPublicApi(
    refreshApi(calls, { kind: "refreshed" }),
    { scope: catalogSourceMatchScope(), pageUrl: normalizedPageUrl },
    { capturedAt },
  );
  assert.deepEqual(calls.refreshInputs, [
    {
      target: { candidateId, sourceId },
      observedPageUrl: normalizedPageUrl,
      capturedAt,
    },
  ]);
});

test("照合失敗と更新失敗はtyped errorと回復案内として伝播する", async () => {
  const matchFailure = await refreshThroughPublicApi(
    refreshApi(
      { matchInputs: [], refreshInputs: [] },
      { kind: "match-failed", error: { kind: "ambiguous-match" } },
    ),
    { scope: catalogSourceMatchScope(), pageUrl: normalizedPageUrl },
    { capturedAt, price },
  );
  assert.deepEqual(matchFailure, {
    kind: "failed",
    error: { kind: "ambiguous-match" },
    recovery: "deduplicate-sources",
  });

  const refreshFailure = await refreshThroughPublicApi(
    refreshApi(
      { matchInputs: [], refreshInputs: [] },
      { kind: "refresh-failed", error: { kind: "conflict" } },
    ),
    { scope: catalogSourceMatchScope(), pageUrl: normalizedPageUrl },
    { capturedAt, price },
  );
  assert.deepEqual(refreshFailure, {
    kind: "failed",
    error: { kind: "conflict" },
    recovery: "reload-candidate",
  });
});

test("公開error unionの全kindが一意の回復案内へ判別される", () => {
  const errors: readonly SourcePriceRefreshError[] = [
    { kind: "invalid-url" },
    { kind: "no-match" },
    { kind: "ambiguous-match" },
    { kind: "ineligible-source" },
    { kind: "price-unavailable" },
    { kind: "stale-activation" },
    { kind: "stale-target" },
    { kind: "tab-unavailable" },
    { kind: "permission-lost" },
    { kind: "restricted-page" },
    { kind: "tab-changed" },
    { kind: "injection-failed" },
    { kind: "invalid-payload" },
    { kind: "validation", fields: {} },
    { kind: "conflict" },
    { kind: "maintenance" },
    { kind: "storage" },
    { kind: "quota" },
    { kind: "unsupported-data" },
  ];
  assert.deepEqual(
    errors.map((error) => sourcePriceRefreshRecovery(error)),
    [
      "review-stored-sources",
      "review-stored-sources",
      "deduplicate-sources",
      "use-retail-source",
      "check-page-price",
      "retry-context-menu",
      "reload-candidate",
      "retry-context-menu",
      "retry-context-menu",
      "retry-context-menu",
      "retry-context-menu",
      "retry-context-menu",
      "retry-context-menu",
      "review-stored-sources",
      "reload-candidate",
      "retry-after-maintenance",
      "check-storage",
      "check-storage",
      "review-stored-sources",
    ],
  );
});

test("隣接consumerは公開入口のURL同一性で照合要求を正規化する", () => {
  assert.deepEqual(
    normalizedCatalogRequest(
      "https://Prices.Example.invalid:443/products/synthetic-part/?utm_source=mail#spec",
    ),
    {
      ok: true,
      value: { scope: { kind: "catalog" }, pageUrl: normalizedPageUrl },
    },
  );
  assert.deepEqual(
    normalizedCatalogRequest("ftp://prices.example.invalid/products/x"),
    { ok: false, error: { kind: "invalid-url" } },
  );
});

test("同一URL再取り込みはtracking差を一致、商品query差を不一致として判定する", () => {
  assert.equal(
    isSameStoredSourcePage(
      matched,
      "https://prices.example.invalid/products/synthetic-part?gclid=abc",
    ),
    true,
  );
  assert.equal(
    isSameStoredSourcePage(
      matched,
      "https://prices.example.invalid/products/synthetic-part?sku=9",
    ),
    false,
  );
});

test("公開consumerはcatalog scopeと候補scopeの照合要求を作り分ける", () => {
  const consumer = createSourcePriceRefreshPublicConsumer(consumerPorts([]));
  const pageUrl = "https://prices.example.invalid/products/synthetic-part";
  assert.deepEqual(consumer.catalogRequest(pageUrl), {
    scope: { kind: "catalog" },
    pageUrl,
  });
  assert.deepEqual(consumer.candidateRequest(candidateId, pageUrl), {
    scope: { kind: "candidate", candidateId },
    pageUrl,
  });
});
