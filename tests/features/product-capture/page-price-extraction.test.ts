import assert from "node:assert/strict";
import test from "node:test";
import type { TargetTabId } from "../../../src/application-shell/public.js";
import { createUtcTimestamp, err, ok } from "../../../src/domain/public.js";
import type { CaptureRuntimePort } from "../../../src/features/product-capture/coordinator.js";
import { createCaptureCoordinator } from "../../../src/features/product-capture/coordinator.js";
import { createCaptureNormalizer } from "../../../src/features/product-capture/normalizer.js";
import { createPagePriceExtractionAdapter } from "../../../src/features/product-capture/page-price-extraction.js";
import { createCandidateRanker } from "../../../src/features/product-capture/ranker.js";

const tabId = 7 as TargetTabId;
const capturedAt = createUtcTimestamp(new Date("2026-07-29T00:00:00.000Z"));

const runtime = (
  overrides: Partial<CaptureRuntimePort> = {},
): CaptureRuntimePort => ({
  async getTab() {
    return ok({ tabId, url: "https://parts.example.invalid/item" });
  },
  async inject(target, requestId) {
    return ok({
      requestId,
      tabId: target.tabId,
      pageUrl: target.url,
      candidates: [
        {
          field: "price",
          rawValue: "$299.00",
          source: "meta",
          sourceLabel: "product:price",
          documentOrder: 1,
        },
        {
          field: "manufacturer",
          rawValue: "Fictional Parts",
          source: "domain-map",
          sourceLabel: "parts.example.invalid",
          documentOrder: Number.MAX_SAFE_INTEGER,
        },
        {
          field: "price",
          rawValue: "249.99 USD",
          source: "json-ld",
          sourceLabel: "offers.price",
          documentOrder: 2,
        },
      ],
    });
  },
  ...overrides,
});

const adapter = (captureRuntime: CaptureRuntimePort) =>
  createPagePriceExtractionAdapter({
    runtime: captureRuntime,
    normalizer: createCaptureNormalizer(),
    ranker: createCandidateRanker(),
    createRequestId: () => "request-price" as never,
    now: () => capturedAt,
  });

test("固定tabの価格候補だけを通常pipelineで選びpage-derived URLと元表記を返す", async () => {
  const result = await adapter(runtime()).extractPrice(tabId);

  assert.deepEqual(result, {
    ok: true,
    value: {
      pageUrl: "https://parts.example.invalid/item",
      capturedAt,
      price: {
        original: "249.99 USD",
        confirmed: { amount: 249.99, currency: "USD" },
      },
    },
  });
});

test("通常取り込みと同じsynthetic候補集合から同じ価格を選びdomain map候補に影響されない", async () => {
  const captureRuntime = runtime();
  const normalizer = createCaptureNormalizer();
  const ranker = createCandidateRanker();
  const coordinator = createCaptureCoordinator({
    runtime: captureRuntime,
    normalizer,
    ranker,
    createRequestId: () => "request-price" as never,
    now: () => capturedAt,
  });
  const pricePort = createPagePriceExtractionAdapter({
    runtime: captureRuntime,
    normalizer,
    ranker,
    createRequestId: () => "request-price" as never,
    now: () => capturedAt,
  });

  const [capture, observation] = await Promise.all([
    coordinator.captureTab(tabId),
    pricePort.extractPrice(tabId),
  ]);
  assert.equal(capture.ok, true);
  assert.equal(observation.ok, true);
  if (!capture.ok || !observation.ok) return;
  const capturePrice = capture.value.draft.fields.find(
    (field) => field.field === "price",
  );
  assert.deepEqual(observation.value.price, {
    original: capturePrice?.rawValue ?? null,
    confirmed: capturePrice?.normalizedValue,
  });
});

test("有効な価格がない場合も価格欠損の観測成功にする", async () => {
  const result = await adapter(
    runtime({
      async inject(target, requestId) {
        return ok({
          requestId,
          tabId: target.tabId,
          pageUrl: target.url,
          candidates: [],
        });
      },
    }),
  ).extractPrice(tabId);

  assert.deepEqual(result, {
    ok: true,
    value: { pageUrl: "https://parts.example.invalid/item", capturedAt },
  });
});

test("runtime境界を6種の値漏えいしないtyped failureへ写像する", async (t) => {
  const cases: readonly [string, CaptureRuntimePort, string][] = [
    [
      "tab不存在",
      runtime({
        async getTab() {
          return err({ kind: "tab-unavailable" });
        },
      }),
      "tab-unavailable",
    ],
    [
      "権限失効",
      runtime({
        async getTab() {
          return err({ kind: "url-unavailable" });
        },
      }),
      "permission-lost",
    ],
    [
      "制限ページ",
      runtime({
        async getTab() {
          return ok({ tabId, url: "chrome://settings/" });
        },
      }),
      "restricted-page",
    ],
    [
      "tab変化",
      runtime({
        async inject(target, requestId) {
          return ok({
            requestId,
            tabId: target.tabId,
            pageUrl: "https://changed.example.invalid/",
            candidates: [],
          });
        },
      }),
      "tab-changed",
    ],
    [
      "注入失敗",
      runtime({
        async inject() {
          return err("unknown");
        },
      }),
      "injection-failed",
    ],
    [
      "payload不正",
      runtime({
        async inject() {
          return ok({ pageUrl: "https://parts.example.invalid/item" });
        },
      }),
      "invalid-payload",
    ],
  ];

  for (const [name, captureRuntime, kind] of cases) {
    await t.test(name, async () => {
      const result = await adapter(captureRuntime).extractPrice(tabId);
      assert.deepEqual(result, { ok: false, error: { kind } });
      assert.doesNotMatch(JSON.stringify(result), /parts|price|https/);
    });
  }
});
