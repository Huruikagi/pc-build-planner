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
    createHandoffIntent: () => err({ kind: "invalid-payload" }),
    conclude: async () => ({ ok: true, value: undefined }),
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

test("制限page・権限喪失・対象tab失効では実行操作を隠す", async () => {
  for (const error of [
    { kind: "restricted-page" },
    { kind: "permission-lost" },
    { kind: "tab-changed" },
  ] as const) {
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
