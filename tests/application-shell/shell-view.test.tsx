import assert from "node:assert/strict";
import test from "node:test";

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import type {
  FeatureId,
  ShellViewState,
} from "../../src/application-shell/contracts.js";
import { ShellView } from "../../src/application-shell/shell-view.js";

const plannerId = "planner" as FeatureId;
const libraryId = "library" as FeatureId;
const navigation = [
  { id: plannerId, label: "構成プラン" },
  { id: libraryId, label: "候補パーツ" },
] as const;

async function renderShell(
  state: ShellViewState,
  children?: ReactNode,
  onRetry?: () => void,
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(() => {
    root.render(
      <ShellView
        state={state}
        navigation={navigation}
        onNavigate={() => {}}
        onRetry={onRetry}
      >
        {children}
      </ShellView>,
    );
  });
  return {
    container,
    cleanup: async () => {
      await act(() => root.unmount());
      container.remove();
    },
  };
}

test("loading、maintenance、empty stateを利用者へ表示する", async () => {
  for (const [state, expected] of [
    [{ kind: "loading" }, "読み込み中"],
    [
      { kind: "maintenance", selected: plannerId, message: "復元処理中です" },
      "復元処理中です",
    ],
    [{ kind: "ready", selected: null }, "利用可能な機能がありません"],
  ] as const) {
    const rendered = await renderShell(state);
    assert.match(rendered.container.textContent ?? "", new RegExp(expected));
    await rendered.cleanup();
  }
});

test("navigationと選択中featureを表示する", async () => {
  const selected: FeatureId[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(() => {
    root.render(
      <ShellView
        state={{ kind: "ready", selected: plannerId }}
        navigation={navigation}
        onNavigate={(id) => selected.push(id)}
      >
        <p>構成画面</p>
      </ShellView>,
    );
  });
  const buttons = container.querySelectorAll("nav button");
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0]?.getAttribute("aria-current"), "page");
  assert.match(container.textContent ?? "", /構成画面/);
  await act(() => (buttons[1] as HTMLButtonElement).click());
  assert.deepEqual(selected, [libraryId]);
  await act(() => root.unmount());
  container.remove();
});

test("外部由来error messageをmarkupではなくテキストとして表示する", async () => {
  const message = '<img src=x onerror="globalThis.compromised=true">';
  const rendered = await renderShell({
    kind: "error",
    message,
    recoverable: false,
  });
  assert.match(rendered.container.textContent ?? "", /<img src=x onerror=/);
  assert.equal(rendered.container.querySelector("img"), null);
  assert.equal(rendered.container.querySelector("script"), null);
  await rendered.cleanup();
});

test("feature render failureを隔離しnavigationと再試行を維持する", async () => {
  const retryCalls: string[] = [];
  let shouldFail = true;
  function BrokenFeature(): ReactNode {
    if (shouldFail) {
      throw new Error("feature failed");
    }
    return <p>復旧した機能</p>;
  }
  const rendered = await renderShell(
    { kind: "ready", selected: plannerId },
    <BrokenFeature />,
    () => {
      retryCalls.push("retry");
      shouldFail = false;
    },
  );
  assert.equal(rendered.container.querySelectorAll("nav button").length, 2);
  assert.match(
    rendered.container.textContent ?? "",
    /機能を表示できませんでした/,
  );
  const retry = rendered.container.querySelector(
    "[data-action='retry']",
  ) as HTMLButtonElement;
  await act(() => retry.click());
  assert.deepEqual(retryCalls, ["retry"]);
  assert.match(rendered.container.textContent ?? "", /復旧した機能/);
  assert.doesNotMatch(
    rendered.container.textContent ?? "",
    /機能を表示できませんでした/,
  );
  await rendered.cleanup();
});

test("feature切替時にもerror boundaryをresetする", async () => {
  function BrokenFeature(): ReactNode {
    throw new Error("planner failed");
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(() => {
    root.render(
      <ShellView
        state={{ kind: "ready", selected: plannerId }}
        navigation={navigation}
        onNavigate={() => {}}
      >
        <BrokenFeature />
      </ShellView>,
    );
  });
  assert.match(container.textContent ?? "", /機能を表示できませんでした/);

  await act(() => {
    root.render(
      <ShellView
        state={{ kind: "ready", selected: libraryId }}
        navigation={navigation}
        onNavigate={() => {}}
      >
        <p>候補パーツ画面</p>
      </ShellView>,
    );
  });
  assert.match(container.textContent ?? "", /候補パーツ画面/);
  assert.doesNotMatch(
    container.textContent ?? "",
    /機能を表示できませんでした/,
  );
  await act(() => root.unmount());
  container.remove();
});
