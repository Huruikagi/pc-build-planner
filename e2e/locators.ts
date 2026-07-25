import type { Locator, Page } from "@playwright/test";

/**
 * Task 1.3 measurement: a temporary spec re-exporting a value from
 * `src/domain/public.js` (a NodeNext `.js`-specifier import into `src/`) was
 * run under Playwright and passed. The transform resolves `src/` modules this
 * way, so `expectedText` (task 5.2) can re-export the default resolver from
 * `src/ui-messages/public.js` as designed in design.md's E2ELocatorHelpers
 * section, without falling back to the locator-only degradation path.
 */

/** Locates a page region by its stable, language-independent `data-region` identifier. */
export const region = (scope: Locator | Page, name: string): Locator =>
  scope.locator(`[data-region="${name}"]`);

/** Locates an action control by its stable, language-independent `data-action` identifier. */
export const action = (scope: Locator | Page, name: string): Locator =>
  scope.locator(`[data-action="${name}"]`);

/** Locates a shell navigation item by feature id, scoped to the navigation landmark. */
export const navItem = (page: Page, featureId: string): Locator =>
  page.locator(`.shell-navigation [data-feature-id="${featureId}"]`);
