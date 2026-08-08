import assert from "node:assert/strict";
import test from "node:test";
import type { TargetTabId } from "../../../src/application-shell/public.js";
import type { RequestId } from "../../../src/domain/public.js";
import { createChromeCaptureRuntimePort } from "../../../src/features/product-capture/chrome-runtime-port.js";

const TAB = 7 as TargetTabId;
const REQUEST = "80000000-0000-4000-8000-000000000001" as RequestId;
const scripting = {
  async executeScript(details: { files?: readonly string[] }) {
    return details.files
      ? [{}]
      : [{ result: { pageUrl: "https://example.invalid/p", candidates: [] } }];
  },
};

test("tabs.getで指定tabだけを解決する", async () => {
  const calls: number[] = [];
  const port = createChromeCaptureRuntimePort({
    tabs: {
      async get(id) {
        calls.push(id);
        return { id, url: "https://example.invalid/p" };
      },
    },
    scripting,
  });
  assert.deepEqual(await port.getTab(TAB), {
    ok: true,
    value: { tabId: TAB, url: "https://example.invalid/p" },
  });
  assert.deepEqual(calls, [TAB]);
});

test("tab失効とURL欠落を識別する", async () => {
  const missing = createChromeCaptureRuntimePort({
    tabs: {
      async get() {
        throw new Error("No tab");
      },
    },
    scripting,
  });
  assert.deepEqual(await missing.getTab(TAB), {
    ok: false,
    error: { kind: "tab-unavailable" },
  });
  const noUrl = createChromeCaptureRuntimePort({
    tabs: {
      async get(id) {
        return { id };
      },
    },
    scripting,
  });
  assert.deepEqual(await noUrl.getTab(TAB), {
    ok: false,
    error: { kind: "url-unavailable" },
  });

  const wrongTab = createChromeCaptureRuntimePort({
    tabs: {
      async get() {
        return { id: 8, url: "https://example.invalid/p" };
      },
    },
    scripting,
  });
  assert.deepEqual(await wrongTab.getTab(TAB), {
    ok: false,
    error: { kind: "tab-unavailable" },
  });

  const emptyUrl = createChromeCaptureRuntimePort({
    tabs: {
      async get(id) {
        return { id, url: "" };
      },
    },
    scripting,
  });
  assert.deepEqual(await emptyUrl.getTab(TAB), {
    ok: false,
    error: { kind: "url-unavailable" },
  });
});

test("injectは固定tabへだけscriptを注入する", async () => {
  const targets: number[] = [];
  const port = createChromeCaptureRuntimePort({
    tabs: {
      async get(id) {
        return { id, url: "https://example.invalid/p" };
      },
    },
    scripting: {
      async executeScript(details) {
        targets.push(details.target.tabId);
        return details.files
          ? [{}]
          : [
              {
                result: {
                  pageUrl: "https://example.invalid/p",
                  candidates: [],
                },
              },
            ];
      },
    },
  });
  const result = await port.inject(
    { tabId: TAB, url: "https://example.invalid/p" },
    REQUEST,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(targets, [TAB, TAB]);
});

test("activeTab権限失効と予期しない注入失敗を機密値なしで分類する", async () => {
  const sensitiveUrl = "https://private.example.invalid/account?token=secret";
  const originalError = console.error;
  const originalWarn = console.warn;
  const logs: unknown[][] = [];
  console.error = (...values) => logs.push(values);
  console.warn = (...values) => logs.push(values);
  try {
    for (const [failure, expected] of [
      [
        new Error(`Cannot access contents of url ${sensitiveUrl}`),
        "permission",
      ],
      [new Error(`renderer failed for ${sensitiveUrl}`), "unknown"],
    ] as const) {
      const targets: number[] = [];
      const port = createChromeCaptureRuntimePort({
        tabs: {
          async get(id) {
            return { id, url: sensitiveUrl };
          },
        },
        scripting: {
          async executeScript(details) {
            targets.push(details.target.tabId);
            throw failure;
          },
        },
      });

      assert.deepEqual(
        await port.inject({ tabId: TAB, url: sensitiveUrl }, REQUEST),
        { ok: false, error: expected },
      );
      assert.deepEqual(targets, [TAB]);
    }
    assert.deepEqual(logs, []);
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }
});

test("ページ側の注入処理が応答しない場合は有限時間で失敗する", async () => {
  for (const unresponsiveCall of [1, 2] as const) {
    let calls = 0;
    const port = createChromeCaptureRuntimePort({
      tabs: {
        async get(id) {
          return { id, url: "https://example.invalid/p" };
        },
      },
      scripting: {
        async executeScript(details) {
          calls += 1;
          if (calls === unresponsiveCall) return new Promise<never>(() => {});
          return details.files
            ? [{}]
            : [
                {
                  result: {
                    pageUrl: "https://example.invalid/p",
                    candidates: [],
                  },
                },
              ];
        },
      },
      injectionTimeoutMs: 5,
    });

    const outcome = await Promise.race([
      port.inject({ tabId: TAB, url: "https://example.invalid/p" }, REQUEST),
      new Promise<"still-pending">((resolve) =>
        setTimeout(() => resolve("still-pending"), 50),
      ),
    ]);

    assert.deepEqual(outcome, { ok: false, error: "unknown" });
    assert.equal(calls, unresponsiveCall);
  }
});

test("ページ側の任意site nameを未検証のまま境界へ引き渡す", async () => {
  const port = createChromeCaptureRuntimePort({
    tabs: {
      async get(id) {
        return { id, url: "https://example.invalid/p" };
      },
    },
    scripting: {
      async executeScript(details: { files?: readonly string[] }) {
        return details.files
          ? [{}]
          : [
              {
                result: {
                  pageUrl: "https://example.invalid/p",
                  candidates: [],
                  siteName: {
                    rawValue: "架空ショップ",
                    source: "open-graph",
                    sourceLabel: "og:site_name",
                    documentOrder: 0,
                  },
                },
              },
            ];
      },
    },
  });

  const injected = await port.inject(
    { tabId: TAB, url: "https://example.invalid/p" },
    REQUEST,
  );

  assert.equal(injected.ok, true);
  if (!injected.ok) return;
  assert.deepEqual((injected.value as { siteName?: unknown }).siteName, {
    rawValue: "架空ショップ",
    source: "open-graph",
    sourceLabel: "og:site_name",
    documentOrder: 0,
  });
});

test("site nameが無いページ結果はsiteNameキーを持たない", async () => {
  const port = createChromeCaptureRuntimePort({
    tabs: {
      async get(id) {
        return { id, url: "https://example.invalid/p" };
      },
    },
    scripting,
  });

  const injected = await port.inject(
    { tabId: TAB, url: "https://example.invalid/p" },
    REQUEST,
  );

  assert.equal(injected.ok, true);
  if (!injected.ok) return;
  assert.equal("siteName" in (injected.value as object), false);
});
