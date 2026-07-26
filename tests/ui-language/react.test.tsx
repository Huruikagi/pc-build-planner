import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { cleanup, render } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { useLanguage } from "../../src/ui-language/react.js";
import { resetUiLanguageForTest } from "../../src/ui-language/store.js";
import { useMessages } from "../../src/ui-messages/public.js";
import { renderWithLanguage } from "./render-with-language.js";

afterEach(() => {
  cleanup();
  resetUiLanguageForTest();
});

function Probe() {
  const messages = useMessages();
  const { language, setLanguage } = useLanguage();
  return (
    <div>
      <p data-region="label">{messages("common.save")}</p>
      <input data-region="input" />
      <button
        type="button"
        data-action="toggle-language"
        onClick={() => setLanguage(language === "ja" ? "en" : "ja")}
      >
        toggle
      </button>
    </div>
  );
}

test("言語を切り替えると同一ツリー内の表示文言が切り替わる", async () => {
  const user = userEvent.setup();
  const { container } = renderWithLanguage(<Probe />);
  const label = container.querySelector<HTMLElement>("[data-region='label']");
  assert.ok(label);
  const before = label.textContent;

  const toggle = container.querySelector<HTMLButtonElement>(
    "[data-action='toggle-language']",
  );
  assert.ok(toggle);
  await user.click(toggle);

  assert.notEqual(label.textContent, before);
});

test("言語切り替えはReactルートを再生成せず、入力途中の値を保持する", async () => {
  const user = userEvent.setup();
  const { container } = renderWithLanguage(<Probe />);
  const input = container.querySelector<HTMLInputElement>(
    "[data-region='input']",
  );
  assert.ok(input);
  await user.type(input, "hello");

  const toggle = container.querySelector<HTMLButtonElement>(
    "[data-action='toggle-language']",
  );
  assert.ok(toggle);
  await user.click(toggle);

  assert.equal(input.value, "hello");
});

test("useLanguageは対応言語の一覧をavailableとして返し、カタログは露出しない", () => {
  let selection: ReturnType<typeof useLanguage> | undefined;
  function Capture() {
    selection = useLanguage();
    return null;
  }
  renderWithLanguage(<Capture />);
  assert.deepEqual(selection?.available, ["ja", "en"]);
  assert.equal(typeof selection?.setLanguage, "function");
});

test("useLanguageはLanguageProviderの外側では呼べない", () => {
  function Bare() {
    useLanguage();
    return null;
  }
  assert.throws(() => render(<Bare />));
});
