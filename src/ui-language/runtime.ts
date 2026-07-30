/**
 * Runtime-composition seam owned by ui-language.
 * UI consumers continue to use public.ts; only the shell-owned runtime entry
 * may use this module to assemble persistence and browser-language adapters.
 */
import type { LanguagePlatform } from "./contracts.js";

import {
  createChromeLanguagePreferencePortIfAvailable,
  createInMemoryLanguagePreferencePort,
} from "./preference-store.js";

export type { LanguagePlatform } from "./contracts.js";
export { syncDocumentLanguage } from "./document-language.js";
export {
  createChromeLanguagePreferencePortIfAvailable,
  createInMemoryLanguagePreferencePort,
} from "./preference-store.js";
export { initializeUiLanguage } from "./store.js";

/**
 * Chrome固有の言語入力と保存adapterを一つのruntime seamで合成する。
 * 非Chrome環境では決定的なin-memory portへフォールバックする。
 */
export const createProductionLanguagePlatform = (): LanguagePlatform => ({
  preferences:
    createChromeLanguagePreferencePortIfAvailable() ??
    createInMemoryLanguagePreferencePort(),
  browserUiLanguage: () =>
    typeof chrome !== "undefined" ? chrome.i18n?.getUILanguage() : undefined,
});
