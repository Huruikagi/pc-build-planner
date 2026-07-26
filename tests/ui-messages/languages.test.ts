import assert from "node:assert/strict";
import test from "node:test";
import {
  FALLBACK_LANGUAGE,
  languageEndonym,
  resolverFor,
  SOURCE_LANGUAGE,
  SUPPORTED_LANGUAGES,
} from "../../src/ui-messages/languages.js";
import { defaultMessageResolver } from "../../src/ui-messages/resolver.js";

// Compile-time guarantee (1.3, 9.3): adding a supported language without
// providing its endonym fails typecheck via `Record<SupportedLanguage, string>`
// mapped-type coverage — the same "欠落はマップ型の網羅性で検出する" mechanism
// CatalogParityTypes uses for catalog keys (1.2).
type HypotheticalSupportedLanguage = "ja" | "en" | "fr";
// @ts-expect-error "fr" endonym is missing.
const _incompleteEndonymTable: Record<HypotheticalSupportedLanguage, string> = {
  ja: "日本語",
  en: "English",
};
void _incompleteEndonymTable;

test("resolverFor(SOURCE_LANGUAGE)は上流の既定resolverと同一参照を指す", () => {
  assert.equal(resolverFor(SOURCE_LANGUAGE), defaultMessageResolver);
});

test("resolverForは同一言語に対して常に同一参照を返す", () => {
  assert.equal(resolverFor("en"), resolverFor("en"));
  assert.equal(resolverFor("ja"), resolverFor("ja"));
});

test("SOURCE_LANGUAGEとFALLBACK_LANGUAGEは異なる言語である", () => {
  assert.notEqual(SOURCE_LANGUAGE, FALLBACK_LANGUAGE);
  assert.equal(SOURCE_LANGUAGE, "ja");
  assert.equal(FALLBACK_LANGUAGE, "en");
});

test("languageEndonymは対応言語すべてを原語表記で持つ", () => {
  assert.deepEqual(
    Object.keys(languageEndonym).sort(),
    [...SUPPORTED_LANGUAGES].sort(),
  );
  assert.equal(languageEndonym.ja, "日本語");
  assert.equal(languageEndonym.en, "English");
});
