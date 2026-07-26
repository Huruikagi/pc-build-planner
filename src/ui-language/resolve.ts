import {
  FALLBACK_LANGUAGE,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from "../ui-messages/public.js";
import type { LanguageResolutionInput } from "./contracts.js";

const SUPPORTED_LANGUAGE_SET: ReadonlySet<string> = new Set(
  SUPPORTED_LANGUAGES,
);

/**
 * BCP47風の言語タグの先頭サブタグ（`-` / `_` 区切り、大文字小文字を無視）を
 * 対応言語と照合する。`ja-JP` / `ja_JP` / `JA` はいずれも `ja` へ解決する。
 * 対応付けられない値、空文字列、非文字列は推測せず `undefined` を返す。
 * 実ブラウザに依存しない純関数（8.3）。
 */
export const normalizeLanguageTag = (
  tag: unknown,
): SupportedLanguage | undefined => {
  if (typeof tag !== "string" || tag.length === 0) return undefined;
  const primarySubtag = tag.split(/[-_]/, 1)[0]?.toLowerCase();
  return primarySubtag !== undefined &&
    SUPPORTED_LANGUAGE_SET.has(primarySubtag)
    ? (primarySubtag as SupportedLanguage)
    : undefined;
};

/**
 * 「保存値 → ブラウザ表示言語 → フォールバック言語」の優先順で初期値を決める。
 * 保存値・ブラウザ表示言語のいずれも対応言語として解釈できない場合は、保存値
 * なしの場合と同じ手順を辿ってフォールバック言語へ帰着する。例外を投げない。
 */
export const resolveInitialLanguage = (
  input: LanguageResolutionInput,
): SupportedLanguage =>
  normalizeLanguageTag(input.stored) ??
  normalizeLanguageTag(input.browserUiLanguage) ??
  FALLBACK_LANGUAGE;
