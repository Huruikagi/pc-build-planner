import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { cleanup } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { LanguageSelectControl } from "../../src/ui-language/language-select.js";
import { resetUiLanguageForTest } from "../../src/ui-language/store.js";
import { SUPPORTED_LANGUAGES } from "../../src/ui-messages/public.js";
import { renderWithLanguage } from "./render-with-language.js";

afterEach(() => {
  cleanup();
  resetUiLanguageForTest();
});

const querySelect = (container: HTMLElement): HTMLSelectElement => {
  const select = container.querySelector("select");
  assert.ok(select);
  return select;
};

test("選択肢はavailableから導出され、対応言語を1つ増やすと自動的に反映される構造になっている", () => {
  const { container } = renderWithLanguage(<LanguageSelectControl />);
  const select = querySelect(container);
  const optionValues = [...select.querySelectorAll("option")].map(
    (option) => option.value,
  );
  assert.deepEqual(optionValues, [...SUPPORTED_LANGUAGES]);
});

test("各選択肢は言語自身の原語表記で表示される", () => {
  const { container } = renderWithLanguage(<LanguageSelectControl />);
  const select = querySelect(container);
  const optionTexts = [...select.querySelectorAll("option")].map(
    (option) => option.textContent,
  );
  assert.deepEqual(optionTexts, ["日本語", "English"]);
});

test("現在選択されている言語がselectの値として判別できる", () => {
  const { container } = renderWithLanguage(<LanguageSelectControl />);
  const select = querySelect(container);
  assert.equal(select.value, "ja");
});

test("コントロールの操作で表示言語が切り替わる", async () => {
  const user = userEvent.setup();
  const { container } = renderWithLanguage(<LanguageSelectControl />);
  const select = querySelect(container);

  await user.selectOptions(select, "en");

  assert.equal(select.value, "en");
});

test("アクセシブル名はカタログ由来である", () => {
  const { container } = renderWithLanguage(<LanguageSelectControl />);
  const select = querySelect(container);
  assert.equal(select.getAttribute("aria-label"), "表示言語");
});
