import assert from "node:assert/strict";
import test from "node:test";
import { createActionClickSidePanelBootstrap } from "../../src/runtime/service-worker.js";

interface FakeTab {
  readonly id?: number;
}

const harness = () => {
  const listeners: Array<(tab: FakeTab) => void> = [];
  const opened: unknown[] = [];
  let openResult: Promise<void> = Promise.resolve();

  return {
    listeners,
    opened,
    setOpenResult(result: Promise<void>) {
      openResult = result;
    },
    runtime: {
      action: {
        onClicked: {
          addListener(listener: (tab: FakeTab) => void) {
            listeners.push(listener);
          },
        },
      },
      sidePanel: {
        open: (options: unknown) => {
          opened.push(options);
          return openResult;
        },
      },
    },
  };
};

test("action clickは同期stack内でsidePanel.openを開始する", () => {
  const h = harness();
  const calls: string[] = [];
  let resolveOpen: (() => void) | undefined;
  h.setOpenResult(
    new Promise((resolve) => {
      resolveOpen = resolve;
    }),
  );
  createActionClickSidePanelBootstrap(h.runtime);

  calls.push("click:start");
  h.listeners[0]?.({ id: 7 });
  calls.push("click:end");

  assert.deepEqual(calls, ["click:start", "click:end"]);
  assert.deepEqual(h.opened, [{ tabId: 7 }]);
  resolveOpen?.();
});

test("tabIdを持たないclickではsidePanelを開かない", () => {
  const h = harness();
  createActionClickSidePanelBootstrap(h.runtime);

  h.listeners[0]?.({});

  assert.deepEqual(h.opened, []);
});

test("side panelを開けなかった場合はreportErrorへ理由を伝える", async () => {
  const h = harness();
  h.setOpenResult(Promise.reject(new Error("boom")));
  const reported: string[] = [];
  createActionClickSidePanelBootstrap(h.runtime, (message) => {
    reported.push(message);
  });

  h.listeners[0]?.({ id: 7 });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(reported, ["Side panelを開けませんでした。"]);
});
