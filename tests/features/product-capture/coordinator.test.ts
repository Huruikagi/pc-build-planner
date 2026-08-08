import assert from "node:assert/strict";
import test from "node:test";
import type { TargetTabId } from "../../../src/application-shell/public.js";
import { err, ok, type RequestId } from "../../../src/domain/public.js";
import {
  type ActiveTabInfo,
  type CaptureRuntimePort,
  createCaptureCoordinator,
  decodeCapturePagePayload,
} from "../../../src/features/product-capture/coordinator.js";
import { createGenericExtractor } from "../../../src/features/product-capture/extractor.js";
import { createCaptureNormalizer } from "../../../src/features/product-capture/normalizer.js";
import { createCandidateRanker } from "../../../src/features/product-capture/ranker.js";

const TAB = 7 as TargetTabId;
const URL = "https://shop.example.invalid/p";
const REQUEST = "80000000-0000-4000-8000-000000000001" as RequestId;
const make = (runtime: CaptureRuntimePort) =>
  createCaptureCoordinator({
    runtime,
    normalizer: createCaptureNormalizer(),
    ranker: createCandidateRanker(),
    createRequestId: () => REQUEST,
  });
const target: ActiveTabInfo = { tabId: TAB, url: URL };

test("runtime payload境界はdocumentOrder欠損・負数・小数・safe integer超過を拒否する", () => {
  for (const documentOrder of [
    undefined,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    const candidate = {
      field: "name",
      rawValue: "x",
      source: "heading",
      sourceLabel: "h1",
      ...(documentOrder === undefined ? {} : { documentOrder }),
    };
    assert.equal(
      decodeCapturePagePayload({
        requestId: REQUEST,
        tabId: TAB,
        pageUrl: URL,
        candidates: [candidate],
      }),
      undefined,
    );
  }
});

test("runtime payload境界は未知fieldと不正なspec fieldを拒否する", () => {
  for (const field of [
    "unexpected-field",
    "spec:",
    "spec:   ",
    `spec:${"x".repeat(81)}`,
    "spec:socket\u0000type",
  ]) {
    assert.equal(
      decodeCapturePagePayload({
        requestId: REQUEST,
        tabId: TAB,
        pageUrl: URL,
        candidates: [
          {
            field,
            rawValue: "x",
            source: "table",
            sourceLabel: "Socket",
            documentOrder: 0,
          },
        ],
      }),
      undefined,
    );
  }
});

test("runtime payload境界は空・過長・制御文字入りsourceLabelを拒否する", () => {
  for (const sourceLabel of ["", "x".repeat(81), "table\u0000header"]) {
    assert.equal(
      decodeCapturePagePayload({
        requestId: REQUEST,
        tabId: TAB,
        pageUrl: URL,
        candidates: [
          {
            field: "name",
            rawValue: "x",
            source: "heading",
            sourceLabel,
            documentOrder: 0,
          },
        ],
      }),
      undefined,
    );
  }
});

test("固定TargetTabIdだけをgetTabとinjectへ渡す", async () => {
  const calls: number[] = [];
  const result = await make({
    async getTab(id) {
      calls.push(id);
      return ok(target);
    },
    async inject(tab) {
      calls.push(tab.tabId);
      return ok({
        requestId: REQUEST,
        tabId: TAB,
        pageUrl: URL,
        candidates: [
          {
            field: "name",
            rawValue: "架空CPU",
            source: "heading",
            sourceLabel: "h1",
            documentOrder: 0,
          },
        ],
      });
    },
  }).captureTab(TAB);
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [TAB, TAB]);
});

test("CaptureResultは一致検証済みpayload pageUrlをcanonical provenanceとして返す", async () => {
  const payloadUrl = `${URL}`;
  const result = await make({
    async getTab() {
      return ok(target);
    },
    async inject() {
      return ok({
        requestId: REQUEST,
        tabId: TAB,
        pageUrl: payloadUrl,
        candidates: [
          {
            field: "name",
            rawValue: "架空CPU",
            source: "heading",
            sourceLabel: "h1",
            documentOrder: 0,
          },
        ],
      });
    },
  }).captureTab(TAB);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.pageUrl, payloadUrl);
});

test("tab不存在とURL欠落は注入せずfail closedに分類する", async () => {
  for (const [failure, expected] of [
    [{ kind: "tab-unavailable" }, "tab-changed"],
    [{ kind: "url-unavailable" }, "permission-lost"],
  ] as const) {
    let injected = false;
    const result = await make({
      async getTab() {
        return err(failure);
      },
      async inject() {
        injected = true;
        return err("unknown");
      },
    }).captureTab(TAB);
    assert.deepEqual(result, { ok: false, error: { kind: expected } });
    assert.equal(injected, false);
  }
});

test("runtimeが固定対象と異なるtabを返した場合は注入前に拒否する", async () => {
  let injected = false;
  const result = await make({
    async getTab() {
      return ok({ tabId: 8 as TargetTabId, url: URL });
    },
    async inject() {
      injected = true;
      return err("unknown");
    },
  }).captureTab(TAB);
  assert.deepEqual(result, { ok: false, error: { kind: "tab-changed" } });
  assert.equal(injected, false);
});

test("制限URLと出所不一致を拒否する", async () => {
  let injected = false;
  const restricted = await make({
    async getTab() {
      return ok({ tabId: TAB, url: "chrome://settings" });
    },
    async inject() {
      injected = true;
      return err("unknown");
    },
  }).captureTab(TAB);
  assert.deepEqual(restricted, {
    ok: false,
    error: { kind: "restricted-page" },
  });
  assert.equal(injected, false);
  const mismatch = await make({
    async getTab() {
      return ok(target);
    },
    async inject() {
      return ok({
        requestId: REQUEST,
        tabId: TAB,
        pageUrl: `${URL}/moved`,
        candidates: [],
      });
    },
  }).captureTab(TAB);
  assert.deepEqual(mismatch, { ok: false, error: { kind: "tab-changed" } });
});

test("注入時の権限失効と実行失敗を識別し、別tabへfallbackしない", async () => {
  for (const [failure, expected] of [
    ["permission", "permission-lost"],
    ["unknown", "injection-failed"],
  ] as const) {
    const lookedUp: TargetTabId[] = [];
    const injected: TargetTabId[] = [];
    const result = await make({
      async getTab(tabId) {
        lookedUp.push(tabId);
        return ok(target);
      },
      async inject(tab) {
        injected.push(tab.tabId);
        return err(failure);
      },
    }).captureTab(TAB);

    assert.deepEqual(result, { ok: false, error: { kind: expected } });
    assert.deepEqual(lookedUp, [TAB]);
    assert.deepEqual(injected, [TAB]);
  }
});

test("request・tab・payload形状の不一致をhandoff前にfail closedにする", async () => {
  const payloads = [
    { requestId: "different", tabId: TAB, pageUrl: URL, candidates: [] },
    { requestId: REQUEST, tabId: 8, pageUrl: URL, candidates: [] },
    { requestId: REQUEST, tabId: TAB, pageUrl: URL, candidates: "invalid" },
  ] as const;

  for (const payload of payloads) {
    const result = await make({
      async getTab() {
        return ok(target);
      },
      async inject() {
        return ok(payload);
      },
    }).captureTab(TAB);
    assert.equal(result.ok, false);
    if (!result.ok)
      assert.ok(["tab-changed", "invalid-payload"].includes(result.error.kind));
  }
});

test("3 metadata familyのsourceはruntime境界を通過する", () => {
  for (const source of ["open-graph", "twitter-card", "product-meta"]) {
    assert.deepEqual(
      decodeCapturePagePayload({
        requestId: REQUEST,
        tabId: TAB,
        pageUrl: URL,
        candidates: [
          {
            field: "name",
            rawValue: "架空GPU",
            source,
            sourceLabel: "og:title",
            documentOrder: 0,
          },
        ],
      })?.candidates[0]?.source,
      source,
    );
  }
});

test("移行前の総称meta sourceはinvalid-payloadとして拒否される", () => {
  assert.equal(
    decodeCapturePagePayload({
      requestId: REQUEST,
      tabId: TAB,
      pageUrl: URL,
      candidates: [
        {
          field: "name",
          rawValue: "架空GPU",
          source: "meta",
          sourceLabel: "og:title",
          documentOrder: 0,
        },
      ],
    }),
    undefined,
  );
});

test("任意site nameはOpenGraph provenanceと元表記を保って境界を通過する", () => {
  const decoded = decodeCapturePagePayload({
    requestId: REQUEST,
    tabId: TAB,
    pageUrl: URL,
    candidates: [],
    siteName: {
      rawValue: "  架空ショップ  ",
      source: "open-graph",
      sourceLabel: "og:site_name",
      documentOrder: 3,
    },
  });

  assert.deepEqual(decoded?.siteName, {
    rawValue: "  架空ショップ  ",
    source: "open-graph",
    sourceLabel: "og:site_name",
    documentOrder: 3,
  });
});

test("site nameの欠損は商品候補の受理を妨げない", () => {
  const decoded = decodeCapturePagePayload({
    requestId: REQUEST,
    tabId: TAB,
    pageUrl: URL,
    candidates: [
      {
        field: "name",
        rawValue: "架空GPU",
        source: "open-graph",
        sourceLabel: "og:title",
        documentOrder: 0,
      },
    ],
  });

  assert.equal(decoded?.candidates.length, 1);
  assert.equal(decoded?.siteName, undefined);
});

test("site name channelはOpenGraph以外のsourceとlabelの組み合わせを拒否する", () => {
  const invalidSiteNames: readonly unknown[] = [
    {
      rawValue: "架空ショップ",
      source: "twitter-card",
      sourceLabel: "og:site_name",
      documentOrder: 0,
    },
    {
      rawValue: "架空ショップ",
      source: "open-graph",
      sourceLabel: "og:title",
      documentOrder: 0,
    },
    {
      rawValue: "架空ショップ",
      source: "domain-map",
      sourceLabel: "og:site_name",
      documentOrder: 0,
    },
    { rawValue: 42, source: "open-graph", sourceLabel: "og:site_name" },
    { source: "open-graph", sourceLabel: "og:site_name", documentOrder: 0 },
    {
      rawValue: "架空ショップ",
      source: "open-graph",
      sourceLabel: "og:site_name",
      documentOrder: -1,
    },
    "架空ショップ",
    null,
  ];

  for (const siteName of invalidSiteNames) {
    assert.equal(
      decodeCapturePagePayload({
        requestId: REQUEST,
        tabId: TAB,
        pageUrl: URL,
        candidates: [],
        siteName,
      }),
      undefined,
    );
  }
});

test("domain-mapはmanufacturer以外のfieldとの組み合わせを拒否する", () => {
  for (const field of ["name", "price", "url"]) {
    assert.equal(
      decodeCapturePagePayload({
        requestId: REQUEST,
        tabId: TAB,
        pageUrl: URL,
        candidates: [
          {
            field,
            rawValue: "架空メーカー",
            source: "domain-map",
            sourceLabel: "maker.example",
            documentOrder: 0,
          },
        ],
      }),
      undefined,
    );
  }
});

test("未列挙sourceのpayloadはinvalid-payloadとして観測できる", async () => {
  const result = await make({
    async getTab() {
      return ok(target);
    },
    async inject() {
      return ok({
        requestId: REQUEST,
        tabId: TAB,
        pageUrl: URL,
        candidates: [
          {
            field: "name",
            rawValue: "架空GPU",
            source: "meta",
            sourceLabel: "og:title",
            documentOrder: 0,
          },
        ],
      });
    },
  }).captureTab(TAB);

  assert.deepEqual(result, { ok: false, error: { kind: "invalid-payload" } });
});

test("有効なsite nameを正規化して抽出結果へ載せる", async () => {
  const result = await make({
    async getTab() {
      return ok(target);
    },
    async inject() {
      return ok({
        requestId: REQUEST,
        tabId: TAB,
        pageUrl: URL,
        candidates: [
          {
            field: "name",
            rawValue: "架空GPU",
            source: "open-graph",
            sourceLabel: "og:title",
            documentOrder: 0,
          },
        ],
        siteName: {
          rawValue: "  架空ショップ  ",
          source: "open-graph",
          sourceLabel: "og:site_name",
          documentOrder: 1,
        },
      });
    },
  }).captureTab(TAB);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.siteName, {
    value: "架空ショップ",
    rawValue: "  架空ショップ  ",
    source: "open-graph",
    sourceLabel: "og:site_name",
  });
});

test("正規化できないsite nameは商品項目と棄却一覧へ影響しない", async () => {
  const result = await make({
    async getTab() {
      return ok(target);
    },
    async inject() {
      return ok({
        requestId: REQUEST,
        tabId: TAB,
        pageUrl: URL,
        candidates: [
          {
            field: "name",
            rawValue: "架空GPU",
            source: "open-graph",
            sourceLabel: "og:title",
            documentOrder: 0,
          },
        ],
        siteName: {
          rawValue: "   ",
          source: "open-graph",
          sourceLabel: "og:site_name",
          documentOrder: 1,
        },
      });
    },
  }).captureTab(TAB);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.siteName, undefined);
  assert.deepEqual(result.value.rejectedFields, []);
  assert.equal(result.value.draft.fields.length, 1);
  assert.equal(result.value.draft.missingCoreFields.includes("name"), false);
});

test("extractorのページ出力はそのままpayload境界を通り抽出結果へ到達する", async () => {
  const page = new DOMParser().parseFromString(
    `<!doctype html><html><head>
      <meta property="og:site_name" content="架空ショップ">
      <meta property="og:title" content="架空GPU G1">
      <meta property="product:brand" content="架空メーカー">
      <meta property="og:description" content="採用してはならない説明">
    </head><body></body></html>`,
    "text/html",
  );
  const extraction = createGenericExtractor().extract(page, URL);

  const result = await make({
    async getTab() {
      return ok(target);
    },
    async inject() {
      return ok({
        requestId: REQUEST,
        tabId: TAB,
        pageUrl: URL,
        candidates: extraction.candidates,
        ...(extraction.siteName === undefined
          ? {}
          : { siteName: extraction.siteName }),
      });
    },
  }).captureTab(TAB);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.siteName?.value, "架空ショップ");
  assert.deepEqual(
    result.value.draft.fields.map((entry) => [entry.field, entry.source]),
    [
      ["name", "open-graph"],
      ["manufacturer", "product-meta"],
    ],
  );
});
