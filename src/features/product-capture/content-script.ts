import { createGenericExtractor } from "./extractor.js";

/**
 * Injected on demand via `chrome.scripting.executeScript({ files: [...] })`
 * from an explicit user gesture only; never declared as a manifest content
 * script and never runs unless the coordinator asks for this exact tab.
 * Assigned on `globalThis` (not `window`) so the same hook name resolves
 * identically in the page's global scope and in this test's DOM harness.
 */
(
  globalThis as typeof globalThis & { __pcbpExtract?: () => unknown }
).__pcbpExtract = () =>
  createGenericExtractor().extract(document, location.href);
