import assert from "node:assert/strict";
import test from "node:test";
import type {
  CandidatePartId,
  CandidateSourceId,
  MoneyValue,
  SourcedValue,
  UtcTimestamp,
} from "../../src/domain/public.js";
import type {
  MatchStoredSourceInput,
  NormalizedSourcePageUrl,
  RefreshCapturedPriceInput,
  SourcePriceRefreshPublicApi,
} from "../../src/features/source-price-refresh/public.js";
import { sameSourcePageUrl } from "../../src/features/source-price-refresh/public.js";
import { refreshDuplicateProductSourcePrice } from "./source-price-refresh-duplicate-product-merge-consumer.js";

const candidateId = "64000000-0000-4000-8000-000000000001" as CandidatePartId;
const sourceId = "64000000-0000-4000-8000-000000000002" as CandidateSourceId;
const pageUrl =
  "https://prices.example.invalid/products/synthetic-part?utm_source=merge";
const normalizedPageUrl =
  "https://prices.example.invalid/products/synthetic-part" as NormalizedSourcePageUrl;
const capturedAt = "2026-08-01T00:00:00.000Z" as UtcTimestamp;
const price: SourcedValue<MoneyValue> = {
  original: "12,800 synthetic yen",
  confirmed: { amount: 12800, currency: "JPY" },
};

test("duplicate-product-merge consumerはcandidate scopeで同一URLをmatchし既存source価格を更新する", async () => {
  const matchInputs: MatchStoredSourceInput[] = [];
  const refreshInputs: RefreshCapturedPriceInput[] = [];
  const api: SourcePriceRefreshPublicApi = {
    refresh: {
      async matchSource(input) {
        matchInputs.push(input);
        if (!sameSourcePageUrl(input.pageUrl, normalizedPageUrl))
          return { ok: false, error: { kind: "no-match" } };
        return {
          ok: true,
          value: { candidateId, sourceId, normalizedPageUrl, isPrimary: true },
        };
      },
      async refreshCapturedPrice(input) {
        refreshInputs.push(input);
        return {
          ok: true,
          value: {
            candidateId,
            sourceId,
            price,
            capturedAt,
            isPrimary: true,
          },
        };
      },
    },
  };

  const result = await refreshDuplicateProductSourcePrice(api, candidateId, {
    pageUrl,
    capturedAt,
    price,
  });

  assert.deepEqual(matchInputs, [
    { scope: { kind: "candidate", candidateId }, pageUrl },
  ]);
  assert.deepEqual(refreshInputs, [
    {
      target: { candidateId, sourceId },
      observedPageUrl: pageUrl,
      capturedAt,
      price,
    },
  ]);
  assert.deepEqual(result, {
    kind: "refreshed",
    receipt: { candidateId, sourceId, price, capturedAt, isPrimary: true },
  });
  assert.equal("addSource" in api.refresh, false);
});

test("duplicate-product-merge consumerはmatch失敗時にrefreshを呼ばない", async () => {
  let refreshCalls = 0;
  const api: SourcePriceRefreshPublicApi = {
    refresh: {
      async matchSource() {
        return { ok: false, error: { kind: "no-match" } };
      },
      async refreshCapturedPrice() {
        refreshCalls += 1;
        throw new Error("refreshCapturedPrice must not run after no-match");
      },
    },
  };
  assert.deepEqual(
    await refreshDuplicateProductSourcePrice(api, candidateId, {
      pageUrl,
      capturedAt,
      price,
    }),
    { kind: "failed", error: { kind: "no-match" } },
  );
  assert.equal(refreshCalls, 0);
});
