import { EN_MESSAGES } from "./catalog/en/index.js";
import type { MessageCatalogShape } from "./catalog/index.js";
import {
  createMessageResolver,
  defaultMessageResolver,
  flattenNamespace,
  type MessageResolver,
} from "./resolver.js";

/**
 * 対応言語の単一の出典。選択肢・初期値決定・保存値の解釈・カタログ網羅性は
 * すべてこの定義から導出する（9.3）。
 */
export const SUPPORTED_LANGUAGES = ["ja", "en"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** カタログの「形」の源。上流の既定resolver（`defaultMessageResolver`）と同一言語。 */
export const SOURCE_LANGUAGE: SupportedLanguage = "ja";

/**
 * 初期値決定で、ブラウザの表示言語が対応言語のいずれにも対応付けられなかった
 * 場合の帰着先（2.4）。ソース言語（カタログの形の源）とは別の概念であり、値も
 * 異なる: ソース言語は日本語、フォールバック言語は英語である。
 */
export const FALLBACK_LANGUAGE: SupportedLanguage = "en";

/** 各言語の原語表記。翻訳対象ではないため、カタログのキーにはしない（1.6）。 */
export const languageEndonym: Readonly<Record<SupportedLanguage, string>> = {
  ja: "日本語",
  en: "English",
};

/**
 * 言語ごとに1つだけ生成し、以後は同一参照を返す（切り替えのたびに作り直さない）。
 * `ja` は上流の`defaultMessageResolver`をそのまま指し、Provider未設置時の表示が
 * 現行と変わらないことを保つ。カタログは全言語とも静的importで束ねる（9.5）。
 */
const RESOLVERS: Readonly<Record<SupportedLanguage, MessageResolver>> = {
  ja: defaultMessageResolver,
  en: createMessageResolver(
    flattenNamespace(EN_MESSAGES) as unknown as MessageCatalogShape,
  ),
};

/** 言語別のresolverを取得する。同一言語には常に同一参照を返す。 */
export const resolverFor = (language: SupportedLanguage): MessageResolver =>
  RESOLVERS[language];
