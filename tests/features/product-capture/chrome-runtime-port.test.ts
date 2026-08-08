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

test("注入と結果読取りはそれぞれ有限時間で終了し、未応答を安定した失敗へ写像する", async () => {
  for (const unresponsiveCall of [1, 2] as const) {
    const pending: Array<() => void> = [];
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
      injectionTimeoutMs: 5_000,
      timeoutScheduler: {
        schedule(onTimeout) {
          pending.push(onTimeout);
          return () => {
            const index = pending.indexOf(onTimeout);
            if (index >= 0) pending.splice(index, 1);
          };
        },
      },
    });

    const injected = port.inject(
      { tabId: TAB, url: "https://example.invalid/p" },
      REQUEST,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Only the unresponsive stage is still waiting, and on its own budget.
    assert.equal(calls, unresponsiveCall);
    assert.equal(pending.length, 1);
    const [fire] = pending;
    assert.ok(fire);
    fire();

    assert.deepEqual(await injected, { ok: false, error: "unknown" });
    assert.equal(calls, unresponsiveCall);
  }
});

test("timeout後に届いたページ結果は現行・後発activationへ適用されず機密値も残さない", async () => {
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalLog = console.log;
  const logs: unknown[][] = [];
  console.error = (...values) => logs.push(values);
  console.warn = (...values) => logs.push(values);
  console.log = (...values) => logs.push(values);
  const lateResults: Array<
    (value: ReadonlyArray<{ result?: unknown }>) => void
  > = [];
  let fireTimeout!: () => void;
  try {
    const port = createChromeCaptureRuntimePort({
      tabs: {
        async get(id) {
          return { id, url: "https://example.invalid/p" };
        },
      },
      scripting: {
        executeScript() {
          return new Promise<ReadonlyArray<{ result?: unknown }>>((resolve) => {
            lateResults.push(resolve);
          });
        },
      },
      timeoutScheduler: {
        schedule(onTimeout) {
          fireTimeout = onTimeout;
          return () => {};
        },
      },
    });

    const injected = port.inject(
      { tabId: TAB, url: "https://example.invalid/p" },
      REQUEST,
    );
    fireTimeout();
    assert.deepEqual(await injected, { ok: false, error: "unknown" });

    // The abandoned page-side call answers afterwards; nothing may pick it up.
    const [resolveLate] = lateResults;
    assert.ok(resolveLate);
    resolveLate([
      {
        result: {
          pageUrl: "https://late.example.invalid/p",
          candidates: [
            {
              field: "name",
              rawValue: "遅延商品",
              source: "json-ld",
              sourceLabel: "name",
              documentOrder: 0,
            },
          ],
        },
      },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(lateResults.length, 1);
    assert.deepEqual(logs, []);
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
    console.log = originalLog;
  }
});

test("scheduler未指定でも既定の実時間timeoutで未応答を終了する", async () => {
  const port = createChromeCaptureRuntimePort({
    tabs: {
      async get(id) {
        return { id, url: "https://example.invalid/p" };
      },
    },
    scripting: {
      executeScript() {
        return new Promise<never>(() => {});
      },
    },
    injectionTimeoutMs: 5,
  });

  assert.deepEqual(
    await port.inject(
      { tabId: TAB, url: "https://example.invalid/p" },
      REQUEST,
    ),
    { ok: false, error: "unknown" },
  );
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
