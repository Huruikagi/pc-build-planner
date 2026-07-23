import assert from "node:assert/strict";
import test from "node:test";
import type { RequestId } from "../../../src/domain/public.js";
import {
  type ChromeScriptingApi,
  type ChromeTabsApi,
  createChromeCaptureRuntimePort,
} from "../../../src/features/product-capture/chrome-runtime-port.js";
import { createCaptureCoordinator } from "../../../src/features/product-capture/coordinator.js";
import { createCaptureNormalizer } from "../../../src/features/product-capture/normalizer.js";
import { createCandidateRanker } from "../../../src/features/product-capture/ranker.js";

const REQUEST_ID = "80000000-0000-4000-8000-000000000001" as RequestId;

interface Harness {
  readonly executeScriptCalls: Array<{
    readonly target: { readonly tabId: number };
    readonly files?: readonly string[];
    readonly func?: () => unknown;
  }>;
  readonly tabs: ChromeTabsApi;
  readonly scripting: ChromeScriptingApi;
  setQueryResult(tabs: ReadonlyArray<{ id?: number; url?: string }>): void;
  setQueryError(): void;
  setFuncResult(result: unknown): void;
  setFilesInjectionError(message: string): void;
  setFuncInjectionError(message: string): void;
}

const harness = (): Harness => {
  const executeScriptCalls: Array<{
    target: { tabId: number };
    files?: readonly string[];
    func?: () => unknown;
  }> = [];
  let queryResult: ReadonlyArray<{ id?: number; url?: string }> = [
    { id: 7, url: "https://shop.example.invalid/products/x100" },
  ];
  let queryShouldThrow = false;
  let funcResult: unknown = {
    pageUrl: "https://shop.example.invalid/products/x100",
    candidates: [
      {
        field: "name",
        rawValue: "架空CPU X100",
        source: "heading",
        sourceLabel: "h1",
      },
    ],
  };
  let filesInjectionError: string | undefined;
  let funcInjectionError: string | undefined;

  return {
    executeScriptCalls,
    setQueryResult(tabs) {
      queryResult = tabs;
    },
    setQueryError() {
      queryShouldThrow = true;
    },
    setFuncResult(result) {
      funcResult = result;
    },
    setFilesInjectionError(message) {
      filesInjectionError = message;
    },
    setFuncInjectionError(message) {
      funcInjectionError = message;
    },
    tabs: {
      async query() {
        if (queryShouldThrow) throw new Error("query failed");
        return queryResult;
      },
    },
    scripting: {
      async executeScript(details) {
        executeScriptCalls.push(details);
        if (details.files !== undefined) {
          if (filesInjectionError !== undefined)
            throw new Error(filesInjectionError);
          return [{}];
        }
        if (funcInjectionError !== undefined)
          throw new Error(funcInjectionError);
        return [{ result: funcResult }];
      },
    },
  };
};

test("getActiveTabは有効なtabId・urlを持つ現在tabを返す", async () => {
  const h = harness();
  const port = createChromeCaptureRuntimePort({
    tabs: h.tabs,
    scripting: h.scripting,
  });

  const tab = await port.getActiveTab();

  assert.deepEqual(tab, {
    tabId: 7,
    url: "https://shop.example.invalid/products/x100",
  });
});

test("getActiveTabはtabがない場合undefinedを返す", async () => {
  const h = harness();
  h.setQueryResult([]);
  const port = createChromeCaptureRuntimePort({
    tabs: h.tabs,
    scripting: h.scripting,
  });

  assert.equal(await port.getActiveTab(), undefined);
});

test("getActiveTabはidまたはurlが欠けたtabをundefinedとして扱う", async () => {
  const h = harness();
  h.setQueryResult([{ id: 7 }]);
  const port = createChromeCaptureRuntimePort({
    tabs: h.tabs,
    scripting: h.scripting,
  });

  assert.equal(await port.getActiveTab(), undefined);
});

test("getActiveTabはquery失敗時にundefinedを返す", async () => {
  const h = harness();
  h.setQueryError();
  const port = createChromeCaptureRuntimePort({
    tabs: h.tabs,
    scripting: h.scripting,
  });

  assert.equal(await port.getActiveTab(), undefined);
});

test("injectはcontent-scriptを注入した後にfuncで結果を取得しrequestId・tabId・pageUrlを付与する", async () => {
  const h = harness();
  const port = createChromeCaptureRuntimePort({
    tabs: h.tabs,
    scripting: h.scripting,
  });

  const result = await port.inject(
    { tabId: 7, url: "https://shop.example.invalid/products/x100" },
    REQUEST_ID,
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, {
    requestId: REQUEST_ID,
    tabId: 7,
    pageUrl: "https://shop.example.invalid/products/x100",
    candidates: [
      {
        field: "name",
        rawValue: "架空CPU X100",
        source: "heading",
        sourceLabel: "h1",
      },
    ],
  });

  assert.equal(h.executeScriptCalls.length, 2);
  assert.deepEqual(h.executeScriptCalls[0]?.files, ["content-script.js"]);
  assert.equal(typeof h.executeScriptCalls[1]?.func, "function");
});

test("injectはfunc結果が期待形状でない場合unknown失敗を返す", async () => {
  for (const invalid of [
    undefined,
    [],
    { candidates: [] },
    { pageUrl: "https://shop.example.invalid/products/x100" },
    { pageUrl: 7, candidates: [] },
    {
      pageUrl: "https://shop.example.invalid/products/x100",
      candidates: "not-an-array",
    },
  ]) {
    const h = harness();
    h.setFuncResult(invalid);
    const port = createChromeCaptureRuntimePort({
      tabs: h.tabs,
      scripting: h.scripting,
    });

    const result = await port.inject(
      { tabId: 7, url: "https://shop.example.invalid/products/x100" },
      REQUEST_ID,
    );

    assert.deepEqual(result, { ok: false, error: "unknown" });
  }
});

test("injectはtarget.urlではなくページが報告したpageUrlを結果へ載せる", async () => {
  const h = harness();
  h.setFuncResult({
    pageUrl: "https://shop.example.invalid/products/moved-y200",
    candidates: [
      {
        field: "name",
        rawValue: "架空GPU Y200",
        source: "heading",
        sourceLabel: "h1",
      },
    ],
  });
  const port = createChromeCaptureRuntimePort({
    tabs: h.tabs,
    scripting: h.scripting,
  });

  const result = await port.inject(
    { tabId: 7, url: "https://shop.example.invalid/products/x100" },
    REQUEST_ID,
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(
    (result.value as { readonly pageUrl: string }).pageUrl,
    "https://shop.example.invalid/products/moved-y200",
  );
});

test("注入前にページが遷移した場合、coordinatorは実runtime port経由でtab-changedとして破棄する", async () => {
  const h = harness();
  // `files` 注入が届く前に遷移が確定し、抽出が別ページで走った状況を再現する。
  h.setFuncResult({
    pageUrl: "https://shop.example.invalid/products/moved-y200",
    candidates: [
      {
        field: "name",
        rawValue: "架空GPU Y200",
        source: "heading",
        sourceLabel: "h1",
      },
    ],
  });
  const coordinator = createCaptureCoordinator({
    runtime: createChromeCaptureRuntimePort({
      tabs: h.tabs,
      scripting: h.scripting,
    }),
    normalizer: createCaptureNormalizer(),
    ranker: createCandidateRanker(),
  });

  const result = await coordinator.captureCurrentTab();

  assert.deepEqual(result, { ok: false, error: { kind: "tab-changed" } });
});

test("遷移がない場合は実runtime port経由の取り込みが成功する", async () => {
  const h = harness();
  const coordinator = createCaptureCoordinator({
    runtime: createChromeCaptureRuntimePort({
      tabs: h.tabs,
      scripting: h.scripting,
    }),
    normalizer: createCaptureNormalizer(),
    ranker: createCandidateRanker(),
  });

  const result = await coordinator.captureCurrentTab();

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(
    result.value.pageUrl,
    "https://shop.example.invalid/products/x100",
  );
  assert.equal(
    result.value.draft.fields.find((field) => field.field === "name")?.rawValue,
    "架空CPU X100",
  );
});

test("injectはactiveTab権限関連のエラーをpermission失敗として分類する", async () => {
  const h = harness();
  h.setFilesInjectionError(
    "Cannot access contents of the page. Extension manifest must request permission to access the respective host.",
  );
  const port = createChromeCaptureRuntimePort({
    tabs: h.tabs,
    scripting: h.scripting,
  });

  const result = await port.inject(
    { tabId: 7, url: "https://shop.example.invalid/products/x100" },
    REQUEST_ID,
  );

  assert.deepEqual(result, { ok: false, error: "permission" });
});

test("injectは分類できない失敗をunknownとして扱う", async () => {
  const h = harness();
  h.setFuncInjectionError("No tab with id: 999.");
  const port = createChromeCaptureRuntimePort({
    tabs: h.tabs,
    scripting: h.scripting,
  });

  const result = await port.inject(
    { tabId: 7, url: "https://shop.example.invalid/products/x100" },
    REQUEST_ID,
  );

  assert.deepEqual(result, { ok: false, error: "unknown" });
});

test("injectは既定のcontent script fileを注入対象へ渡す", async () => {
  const h = harness();
  const port = createChromeCaptureRuntimePort({
    tabs: h.tabs,
    scripting: h.scripting,
    contentScriptFile: "custom-content-script.js",
  });

  await port.inject(
    { tabId: 7, url: "https://shop.example.invalid/products/x100" },
    REQUEST_ID,
  );

  assert.deepEqual(h.executeScriptCalls[0]?.files, [
    "custom-content-script.js",
  ]);
});
