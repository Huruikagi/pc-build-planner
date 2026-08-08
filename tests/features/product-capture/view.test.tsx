import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup, render } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type {
  ActivationId,
  FeatureActivationIntent,
  TargetTabId,
} from "../../../src/application-shell/public.js";
import { err } from "../../../src/domain/public.js";
import { createCaptureState } from "../../../src/features/product-capture/state.js";
import { CaptureView } from "../../../src/features/product-capture/view.js";
import { LanguageProvider } from "../../../src/ui-language/public.js";
import { resolverFor } from "../../../src/ui-messages/public.js";

afterEach(cleanup);
const A = "activation" as ActivationId;
const TAB = 7 as TargetTabId;
const setup = (
  error:
    | { readonly kind: "permission-lost" }
    | { readonly kind: "restricted-page" }
    | { readonly kind: "tab-changed" }
    | { readonly kind: "injection-failed" }
    | { readonly kind: "no-candidate" } = { kind: "injection-failed" },
) => {
  const state = createCaptureState({
    coordinator: { captureTab: async () => err(error) },
    isCurrent: () => true,
    handoff: {
      prepare: () => err({ kind: "invalid-payload" }),
      prepareManual: () => ({}) as never,
      conclude: async () => ({ ok: true, value: undefined }),
      retry: async () => ({ ok: true, value: undefined }),
    },
  });
  state.activate(A, TAB);
  return state;
};

test("idleは開始操作だけを表示し旧編集・保存UIを表示しない", () => {
  const view = render(
    <LanguageProvider>
      <CaptureView state={setup()} />
    </LanguageProvider>,
  );
  assert.ok(view.container.querySelector("[data-capture-start]"));
  assert.equal(view.container.querySelector("[data-capture-submit]"), null);
  assert.equal(
    view.container.querySelector("[data-capture-project-select]"),
    null,
  );
  assert.equal(view.container.querySelector("[data-region='review']"), null);
});

test("候補なしだけ手入力開始操作を表示する", async () => {
  const state = setup({ kind: "no-candidate" });
  const view = render(
    <LanguageProvider>
      <CaptureView state={state} />
    </LanguageProvider>,
  );
  const start = view.container.querySelector("[data-capture-start]");
  assert.ok(start);
  await userEvent.setup().click(start);
  assert.ok(view.container.querySelector("[data-capture-manual]"));
  assert.equal(view.container.querySelector("[data-capture-retry]"), null);
});

test("実行中は操作を隠し、失敗後は安全な案内とretryを表示する", async () => {
  const state = setup();
  const view = render(
    <LanguageProvider>
      <CaptureView state={state} />
    </LanguageProvider>,
  );
  const start = view.container.querySelector("[data-capture-start]");
  assert.ok(start);
  await userEvent.setup().click(start);
  assert.ok(view.container.querySelector("[role='alert']"));
  assert.equal(
    view.container.querySelector("[data-capture-retry]")?.textContent,
    resolverFor("ja")("capture.retryAction"),
  );
  assert.equal(view.container.querySelector("[data-capture-start]"), null);
});

test("handoff失敗はDevToolsなしでも安全な固定理由を識別できる", () => {
  const state = setup();
  state.retainHandoffFailure(
    { kind: "transition-failed", reason: "operation-blocked" },
    {
      featureId: "candidate-management" as never,
      target: "open-candidate-editor",
      payload: {},
    } satisfies FeatureActivationIntent,
  );
  const view = render(
    <LanguageProvider>
      <CaptureView state={state} />
    </LanguageProvider>,
  );

  assert.equal(
    view.container.querySelector("[data-capture-handoff-reason]")?.textContent,
    "失敗理由: operation-blocked",
  );
  assert.equal(
    view.container.querySelector("[data-capture-handoff-retained]")
      ?.textContent,
    resolverFor("ja")("capture.handoffRetainedNotice"),
  );
  assert.equal(
    view.container.querySelector("[data-capture-new-generation-hint]")
      ?.textContent,
    resolverFor("ja")("capture.newGenerationHint"),
  );
  assert.equal(
    view.container.querySelector("[data-capture-retry]")?.textContent,
    resolverFor("ja")("capture.retryHandoffAction"),
  );
});

test("全表示状態でsite name確認・project選択・保存操作を持たない", async () => {
  const forbidden = [
    "[data-capture-site-name]",
    "[data-capture-project-select]",
    "[data-capture-submit]",
    "[data-capture-save]",
    "[data-region='review']",
    "form",
    "input",
    "select",
    "textarea",
  ];
  const assertNoLegacySurface = (container: HTMLElement, label: string) => {
    for (const selector of forbidden)
      assert.equal(
        container.querySelector(selector),
        null,
        `${label}: ${selector} must not exist`,
      );
  };

  // idle → 実行 → 実行失敗 を同じ面で辿る。
  const state = setup();
  const view = render(
    <LanguageProvider>
      <CaptureView state={state} />
    </LanguageProvider>,
  );
  assertNoLegacySurface(view.container, "idle");
  const start = view.container.querySelector("[data-capture-start]");
  assert.ok(start);
  await userEvent.setup().click(start);
  assertNoLegacySurface(view.container, "failed");
  cleanup();

  // handoff失敗による再試行表示は、その状態を確定させてから描画して確認する。
  const retryState = setup();
  retryState.retainHandoffFailure(
    { kind: "transition-failed", reason: "operation-blocked" },
    {
      featureId: "candidate-management" as never,
      target: "open-candidate-editor",
      payload: {},
    } satisfies FeatureActivationIntent,
  );
  const retryView = render(
    <LanguageProvider>
      <CaptureView state={retryState} />
    </LanguageProvider>,
  );
  assert.ok(retryView.container.querySelector("[data-capture-retry]"));
  assertNoLegacySurface(retryView.container, "handoff-retry");
});

test("保持したページ由来値を描画せずHTML注入もしない", () => {
  const state = setup();
  const injected = '<img src=x onerror="alert(1)">SYN 架空ショップ';
  state.retainHandoffFailure(
    { kind: "transition-failed", reason: "operation-blocked" },
    {
      featureId: "candidate-management" as never,
      target: "open-candidate-editor",
      payload: {
        draft: {
          product: { name: { original: injected, confirmed: injected } },
          sources: [{ pageUrl: injected, siteName: injected }],
          sourceSnapshot: { siteName: injected },
        },
      },
    } satisfies FeatureActivationIntent,
  );
  const view = render(
    <LanguageProvider>
      <CaptureView state={state} />
    </LanguageProvider>,
  );

  // 一過性面はページ由来値を提示しないため、text・属性・入力値のどこにも現れない。
  assert.equal(view.container.textContent?.includes("SYN 架空ショップ"), false);
  assert.equal(view.container.innerHTML.includes("SYN 架空ショップ"), false);
  assert.equal(view.container.querySelector("img"), null);
  assert.equal(view.container.querySelector("script"), null);
  assert.equal(view.container.querySelector("iframe"), null);
  assert.doesNotMatch(view.container.innerHTML, /onerror/i);
});

test("制限pageでは案内を維持し実行操作を隠す", async () => {
  for (const error of [{ kind: "restricted-page" }] as const) {
    const view = render(
      <LanguageProvider>
        <CaptureView state={setup(error)} />
      </LanguageProvider>,
    );
    const start = view.container.querySelector("[data-capture-start]");
    assert.ok(start);
    await userEvent.setup().click(start);
    assert.ok(view.container.querySelector("[role='alert']"));
    assert.equal(view.container.querySelector("[data-capture-retry]"), null);
    cleanup();
  }
});
