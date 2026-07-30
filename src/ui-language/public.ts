/**
 * `ui-language` のUI consumer向け公開入口。ストアの実体・保存経路・解決ロジックは
 * ここから公開しない。`application-shell` と各 feature の root はこの入口だけを
 * 参照し、runtime compositionは専用のruntime.ts seamを利用する。
 */

export { LanguageSelectControl } from "./language-select.js";
export type { LanguageSelection } from "./react.js";
export { LanguageProvider, useLanguage } from "./react.js";
