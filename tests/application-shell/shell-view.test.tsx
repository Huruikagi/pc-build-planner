import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import type {
  FeatureId,
  ShellViewState,
} from "../../src/application-shell/contracts.js";
import { ShellView } from "../../src/application-shell/shell-view.js";
import { LanguageProvider } from "../../src/ui-language/public.js";
import { resetUiLanguageForTest } from "../../src/ui-language/store.js";
import {
  defaultMessageResolver,
  type MessageKey,
  message,
} from "../../src/ui-messages/public.js";

afterEach(() => {
  resetUiLanguageForTest();
});

const plannerId = "planner" as FeatureId;
const libraryId = "library" as FeatureId;
const navigation = [
  { id: plannerId, labelKey: "構成プラン" as MessageKey },
  { id: libraryId, labelKey: "候補パーツ" as MessageKey },
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
      <LanguageProvider>
        <ShellView
          state={state}
          navigation={navigation}
          onNavigate={() => {}}
          onRetry={onRetry}
        >
          {children}
        </ShellView>
      </LanguageProvider>,
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
    [{ kind: "loading" }, defaultMessageResolver("shell.loading")],
    [
      {
        kind: "maintenance",
        selected: plannerId,
        message: message("shell.maintenanceActive"),
      },
      defaultMessageResolver("shell.maintenanceActive"),
    ],
    [
      { kind: "ready", selected: null },
      defaultMessageResolver("shell.emptyHeading"),
    ],
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
      <LanguageProvider>
        <ShellView
          state={{ kind: "ready", selected: plannerId }}
          navigation={navigation}
          onNavigate={(id) => selected.push(id)}
        >
          <p>構成画面</p>
        </ShellView>
      </LanguageProvider>,
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

test("一過性起動noticeをreadyとmaintenanceの常設面に安全なtextで併存表示する", async () => {
  const unsafe = '<img src=x onerror="globalThis.compromised=true">';
  for (const state of [
    {
      kind: "ready" as const,
      selected: plannerId,
      transientNotice: {
        message: message("shell.transientActivationUnavailable", {
          detail: unsafe,
        }),
        recoverable: true as const,
      },
    },
    {
      kind: "maintenance" as const,
      selected: plannerId,
      message: message("shell.maintenanceActive"),
      transientNotice: {
        message: message("shell.transientActivationUnavailable", {
          detail: unsafe,
        }),
        recoverable: true as const,
      },
    },
  ]) {
    const rendered = await renderShell(
      state,
      <button type="button">常設操作</button>,
    );
    assert.ok(
      rendered.container.querySelector("[data-region='transient-notice']"),
    );
    const language = rendered.container.querySelector<HTMLSelectElement>(
      "[data-region='language-select']",
    );
    assert.ok(language);
    await act(() => {
      language.value = "ja";
      language.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    assert.match(
      rendered.container.querySelector("[data-region='transient-notice']")
        ?.textContent ?? "",
      /拡張アイコンを再操作してください/,
    );
    assert.match(rendered.container.textContent ?? "", /常設操作/);
    assert.equal(rendered.container.querySelector("img"), null);
    await act(() => {
      language.value = "en";
      language.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    assert.match(
      rendered.container.querySelector("[data-region='transient-notice']")
        ?.textContent ?? "",
      /Use the extension icon again/,
    );
    await rendered.cleanup();
  }
});

test("外部由来error messageをmarkupではなくテキストとして表示する", async () => {
  const unsafeReason = '<img src=x onerror="globalThis.compromised=true">';
  const rendered = await renderShell({
    kind: "error",
    message: message("shell.featureUnavailable", {
      featureId: "planner",
      reason: unsafeReason,
    }),
    recoverable: false,
  });
  assert.match(rendered.container.textContent ?? "", /<img src=x onerror=/);
  assert.equal(rendered.container.querySelector("img"), null);
  assert.equal(rendered.container.querySelector("script"), null);
  await rendered.cleanup();
});

test("recoverable errorはfeature操作を隠して再試行操作だけを提示する", async () => {
  const retryCalls: string[] = [];
  const rendered = await renderShell(
    {
      kind: "error",
      message: message("shell.featureUnmountFailed", {
        featureId: "capture",
      }),
      recoverable: true,
    },
    <button data-action="transient-operation" type="button">
      一過性操作
    </button>,
    () => retryCalls.push("retry"),
  );
  const feature =
    rendered.container.querySelector<HTMLElement>(".shell-feature");
  assert.ok(feature);
  assert.equal(feature.hidden, true);
  const retry = rendered.container.querySelector<HTMLButtonElement>(
    "[data-action='retry']",
  );
  assert.ok(retry);
  await act(() => retry.click());
  assert.deepEqual(retryCalls, ["retry"]);
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
    new RegExp(defaultMessageResolver("shell.featureFailureHeading")),
  );
  const retry = rendered.container.querySelector(
    "[data-action='retry']",
  ) as HTMLButtonElement;
  await act(() => retry.click());
  assert.deepEqual(retryCalls, ["retry"]);
  assert.match(rendered.container.textContent ?? "", /復旧した機能/);
  assert.doesNotMatch(
    rendered.container.textContent ?? "",
    new RegExp(defaultMessageResolver("shell.featureFailureHeading")),
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
      <LanguageProvider>
        <ShellView
          state={{ kind: "ready", selected: plannerId }}
          navigation={navigation}
          onNavigate={() => {}}
        >
          <BrokenFeature />
        </ShellView>
      </LanguageProvider>,
    );
  });
  assert.match(
    container.textContent ?? "",
    new RegExp(defaultMessageResolver("shell.featureFailureHeading")),
  );

  await act(() => {
    root.render(
      <LanguageProvider>
        <ShellView
          state={{ kind: "ready", selected: libraryId }}
          navigation={navigation}
          onNavigate={() => {}}
        >
          <p>候補パーツ画面</p>
        </ShellView>
      </LanguageProvider>,
    );
  });
  assert.match(container.textContent ?? "", /候補パーツ画面/);
  assert.doesNotMatch(
    container.textContent ?? "",
    new RegExp(defaultMessageResolver("shell.featureFailureHeading")),
  );
  await act(() => root.unmount());
  container.remove();
});

test("読み込み中・通常・エラー・保守中の全状態で言語コントロールが描画される", async () => {
  const states: ShellViewState[] = [
    { kind: "loading" },
    { kind: "ready", selected: plannerId },
    {
      kind: "error",
      message: message("shell.startupFailed"),
      recoverable: false,
    },
    {
      kind: "maintenance",
      selected: plannerId,
      message: message("shell.maintenanceActive"),
    },
  ];
  for (const state of states) {
    const rendered = await renderShell(state);
    const select = rendered.container.querySelector(
      "[data-region='shell-header'] [data-region='language-select']",
    );
    assert.ok(select, `expected language control for state ${state.kind}`);
    await rendered.cleanup();
  }
});

test("言語コントロールの操作で表示文言が切り替わる", async () => {
  const rendered = await renderShell({ kind: "loading" });
  const select = rendered.container.querySelector<HTMLSelectElement>(
    "[data-region='language-select']",
  );
  assert.ok(select);
  const before = rendered.container.textContent;
  await act(() => {
    select.value = "en";
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  assert.notEqual(rendered.container.textContent, before);
  await rendered.cleanup();
});
