/**
 * Runtime-composition seam owned by ui-language.
 * UI consumers continue to use public.ts; only the shell-owned runtime entry
 * may use this module to assemble persistence and browser-language adapters.
 */
export type { LanguagePlatform } from "./contracts.js";
export { syncDocumentLanguage } from "./document-language.js";
export {
  createChromeLanguagePreferencePortIfAvailable,
  createInMemoryLanguagePreferencePort,
} from "./preference-store.js";
export { initializeUiLanguage } from "./store.js";
