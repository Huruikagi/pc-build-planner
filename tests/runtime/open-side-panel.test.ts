import assert from "node:assert/strict";
import test from "node:test";

import { createOpenSidePanelGestureHandler } from "../../src/runtime/open-side-panel.js";

test("user gesture handlerの同期stack内でhost準備より先にSide Panel APIを開始する", async () => {
  const calls: string[] = [];
  let resolveOpen: (() => void) | undefined;
  const openPending = new Promise<void>((resolve) => {
    resolveOpen = resolve;
  });
  const handler = createOpenSidePanelGestureHandler({
    open: () => {
      calls.push("open");
      return openPending;
    },
  });

  calls.push("gesture:start");
  const resultPending = handler({ windowId: 7 });
  calls.push("gesture:end");

  assert.deepEqual(calls, ["gesture:start", "open", "gesture:end"]);
  resolveOpen?.();
  assert.deepEqual(await resultPending, { ok: true, value: undefined });
});

test("API rejectを安全なdiagnosticへ変換し無関係なfeature stateを変更しない", async () => {
  const featureState = { selectedFeature: "candidate-list" };
  const handler = createOpenSidePanelGestureHandler({
    open: () =>
      Promise.reject(new Error("https://private.example/product?token=secret")),
  });

  const result = await handler({ tabId: 42 });

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "side-panel-open-failed",
      message: "Side panelを開けませんでした。",
    },
  });
  assert.deepEqual(featureState, { selectedFeature: "candidate-list" });
  assert.equal(JSON.stringify(result).includes("private.example"), false);
});

test("同期例外もrejectと同じ安全なdiagnosticへ隔離する", async () => {
  const handler = createOpenSidePanelGestureHandler({
    open: () => {
      throw "untrusted error detail";
    },
  });

  assert.deepEqual(await handler({ windowId: 9 }), {
    ok: false,
    error: {
      code: "side-panel-open-failed",
      message: "Side panelを開けませんでした。",
    },
  });
});
