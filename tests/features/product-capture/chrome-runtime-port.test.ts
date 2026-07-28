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
