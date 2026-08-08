import { createGenericExtractor } from "./extractor.js";

/**
 * Injected on demand via `chrome.scripting.executeScript({ files: [...] })`
 * from an explicit user gesture only; never declared as a manifest content
 * script and never runs unless the coordinator asks for this exact tab.
 * Assigned on `globalThis` (not `window`) so the same hook name resolves
 * identically in the page's global scope and in this test's DOM harness.
 *
 * Reports the page's own `location.href` next to the candidates: a navigation
 * that commits between the coordinator reading the active tab and this script
 * landing would otherwise stamp the new page's values with the old page's URL,
 * which Requirement 6.1 requires be rejected rather than saved.
 */
(
  globalThis as typeof globalThis & { __pcbpExtract?: () => unknown }
).__pcbpExtract = () => {
  const pageUrl = location.href;
  const { candidates, siteName } = createGenericExtractor().extract(
    document,
    pageUrl,
  );
  return {
    pageUrl,
    candidates,
    ...(siteName === undefined ? {} : { siteName }),
  };
};
