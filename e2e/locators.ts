import type { Locator, Page } from "@playwright/test";

import { defaultMessageResolver } from "../src/ui-messages/public.js";

type FormFieldName =
  | "attribute-memoryStandard"
  | "attribute-socket"
  | "candidate-category"
  | "candidate-name"
  | "project-name";

/**
 * Task 1.3 measurement: a temporary spec re-exporting a value from
 * `src/domain/public.js` (a NodeNext `.js`-specifier import into `src/`) was
 * run under Playwright and passed. The transform resolves `src/` modules this
 * way, so `expectedText` (task 5.2) re-exports the default resolver from
 * `src/ui-messages/public.js` as designed in design.md's E2ELocatorHelpers
 * section, without falling back to the locator-only degradation path.
 */

/** Resolves catalog text for E2E expected-value assertions (design.md's E2ELocatorHelpers). */
export const expectedText = defaultMessageResolver;

/** Locates the application shell runtime root. */
export const applicationShell = (page: Page): Locator =>
  page.locator("#application-shell");

/** Locates a feature's shell-owned root by its stable registration id. */
export const featureRoot = (page: Page, featureId: string): Locator =>
  page.locator(`.shell-feature[data-feature-id="${featureId}"]`);

/** Locates a page region by its stable, language-independent `data-region` identifier. */
export const region = (scope: Locator | Page, name: string): Locator =>
  scope.locator(`[data-region="${name}"]`);

/** Locates an action control by its stable, language-independent `data-action` identifier. */
export const action = (scope: Locator | Page, name: string): Locator =>
  scope.locator(`[data-action="${name}"]`);

/** Locates a shell navigation item by feature id, scoped to the navigation landmark. */
export const navItem = (page: Page, featureId: string): Locator =>
  page.locator(`.shell-navigation [data-feature-id="${featureId}"]`);

/** Locates one of the stable named fields used by E2E setup flows. */
export const formField = (
  scope: Locator | Page,
  name: FormFieldName,
): Locator => scope.locator(`[name="${name}"]`);

/** Locates the submit control owned by a form region. */
export const submitButton = (form: Locator): Locator =>
  form.locator('button[type="submit"]');

/** Locates the restore file control inside the restore region. */
export const restoreFileInput = (restoreRegion: Locator): Locator =>
  restoreRegion.locator('input[type="file"]');

/** Locates the document body for whole-page message assertions. */
export const documentBody = (page: Page): Locator => page.locator("body");

/** Locates the stable candidate-creation affordance. */
export const createCandidateButton = (feature: Locator): Locator =>
  feature.locator("[data-create-candidate]");

/** Locates the edit affordance for a candidate row. */
export const editCandidateButton = (candidateRow: Locator): Locator =>
  candidateRow.locator("[data-edit-candidate-id]");

/** Locates a category switcher by its stable domain category id. */
export const categoryButton = (build: Locator, category: string): Locator =>
  build.locator(`[data-category="${category}"]`);

/** Locates the select affordance for a current-build candidate row. */
export const selectCandidateButton = (candidateRow: Locator): Locator =>
  candidateRow.locator("[data-select-candidate-id]");

/** Locates the remove affordance for a current-build candidate row. */
export const removeCandidateButton = (candidateRow: Locator): Locator =>
  candidateRow.locator("[data-remove-candidate-id]");

/** Locates the quantity input for a multi-select candidate row. */
export const quantityInput = (candidateRow: Locator): Locator =>
  candidateRow.locator("input[data-quantity-input]");

/** Locates the quantity confirmation affordance for a candidate row. */
export const confirmQuantityButton = (candidateRow: Locator): Locator =>
  candidateRow.locator("[data-confirm-quantity]");

/** Locates the stable product-capture start affordance. */
export const captureStartButton = (capture: Locator): Locator =>
  capture.locator("[data-capture-start]");

/** Locates the stable product-capture retry affordance. */
export const captureRetryButton = (capture: Locator): Locator =>
  capture.locator("[data-capture-retry]");
