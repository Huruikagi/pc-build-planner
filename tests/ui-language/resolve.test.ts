import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeLanguageTag,
  resolveInitialLanguage,
} from "../../src/ui-language/resolve.js";

// Requirement 2.1-2.4, 8.3: table-driven fixture covering region subtags,
// separator variants, casing, unsupported tags, empty string, undefined,
// and non-string values — verified without launching a real browser.
const NORMALIZE_CASES: ReadonlyArray<
  readonly [label: string, input: unknown, expected: string | undefined]
> = [
  ["ja", "ja", "ja"],
  ["ja-JP", "ja-JP", "ja"],
  ["ja_JP", "ja_JP", "ja"],
  ["JA", "JA", "ja"],
  ["en", "en", "en"],
  ["en-US", "en-US", "en"],
  ["en-GB", "en-GB", "en"],
  ["fr (unsupported)", "fr", undefined],
  ["zh-CN (unsupported)", "zh-CN", undefined],
  ["empty string", "", undefined],
  ["undefined", undefined, undefined],
  ["null", null, undefined],
  ["number", 42, undefined],
  ["object", { language: "ja" }, undefined],
];

test("normalizeLanguageTagは地域サブタグ・区切り文字・大文字小文字の違いを吸収する", () => {
  for (const [label, input, expected] of NORMALIZE_CASES) {
    assert.equal(normalizeLanguageTag(input), expected, label);
  }
});

test("resolveInitialLanguageは保存値を最優先で使う", () => {
  assert.equal(
    resolveInitialLanguage({ stored: "en", browserUiLanguage: "ja" }),
    "en",
  );
});

test("resolveInitialLanguageは保存値が無ければブラウザ表示言語を対応言語へ対応付ける", () => {
  assert.equal(
    resolveInitialLanguage({
      stored: undefined,
      browserUiLanguage: "ja-JP",
    }),
    "ja",
  );
});

test("resolveInitialLanguageは保存値が解釈できない場合は保存値なしと同じ手順を辿る", () => {
  assert.equal(
    resolveInitialLanguage({ stored: "fr", browserUiLanguage: "ja" }),
    "ja",
  );
});

test("resolveInitialLanguageはいずれも解釈できない場合はフォールバック言語(en)を使う", () => {
  assert.equal(
    resolveInitialLanguage({ stored: "fr", browserUiLanguage: "zh-CN" }),
    "en",
  );
  assert.equal(
    resolveInitialLanguage({ stored: undefined, browserUiLanguage: undefined }),
    "en",
  );
});
