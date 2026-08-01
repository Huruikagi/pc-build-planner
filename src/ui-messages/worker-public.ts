/**
 * Worker-safe message entry. Unlike `public.ts`, this module does not export
 * React providers and therefore remains safe in the MV3 service-worker graph.
 */
export type { SupportedLanguage } from "./languages.js";
export { FALLBACK_LANGUAGE, resolverFor } from "./languages.js";
