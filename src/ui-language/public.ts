/**
 * `ui-language` の唯一の公開入口。ストアの実体・保存経路・解決ロジックは
 * ここから公開しない。`application-shell` と各 feature の root はこの入口
 * だけを参照する。
 */

export { LanguageSelectControl } from "./language-select.js";
export type { LanguageSelection } from "./react.js";
export { LanguageProvider, useLanguage } from "./react.js";
