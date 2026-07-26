import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { syncDocumentLanguage } from "../../src/ui-language/document-language.js";
import { createInMemoryLanguagePreferencePort } from "../../src/ui-language/preference-store.js";
import {
  initializeUiLanguage,
  resetUiLanguageForTest,
  uiLanguageStore,
} from "../../src/ui-language/store.js";

const originalLang = document.documentElement.lang;

afterEach(() => {
  resetUiLanguageForTest();
  document.documentElement.lang = originalLang;
});

test("呼び出し直後に文書の言語属性を現在の言語へ設定する", () => {
  const unsubscribe = syncDocumentLanguage(document);
  assert.equal(document.documentElement.lang, uiLanguageStore.getSnapshot());
  unsubscribe();
});

test("言語切り替えに文書の言語属性が追随する", async () => {
  const preferences = createInMemoryLanguagePreferencePort();
  await initializeUiLanguage({ preferences, browserUiLanguage: () => "ja" });
  const unsubscribe = syncDocumentLanguage(document);

  uiLanguageStore.setLanguage("en");
  assert.equal(document.documentElement.lang, "en");

  uiLanguageStore.setLanguage("ja");
  assert.equal(document.documentElement.lang, "ja");

  unsubscribe();
});

test("購読解除後は文書の言語属性を更新しない", async () => {
  const preferences = createInMemoryLanguagePreferencePort();
  await initializeUiLanguage({ preferences, browserUiLanguage: () => "ja" });
  const unsubscribe = syncDocumentLanguage(document);

  unsubscribe();
  uiLanguageStore.setLanguage("en");

  assert.equal(document.documentElement.lang, "ja");
});

test("属性値は常に対応言語のいずれかである", () => {
  const unsubscribe = syncDocumentLanguage(document);
  assert.ok(["ja", "en"].includes(document.documentElement.lang));
  unsubscribe();
});
