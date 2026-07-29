import type { Locator, Page } from "@playwright/test";

import {
  defaultMessageResolver,
  resolverFor,
  type SupportedLanguage,
} from "../src/ui-messages/public.js";

type FormFieldName =
  | "attribute-memoryStandard"
  | "attribute-socket"
  | "candidate-category"
  | "candidate-name"
  | "project-name";

type CandidateSourceFieldName = "captured-at" | "kind" | "site-name" | "url";

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

/** Resolves catalog text for a specific display language, for language-switching E2E specs. */
export const expectedTextFor = resolverFor;

/** Locates the display-language switch control mounted in the shell header. */
export const languageSelect = (page: Page): Locator =>
  page.locator('[data-region="language-select"]');

/**
 * Switches the display language via the in-panel control (never the browser
 * locale, launch flags, or a restart — 8.1, 8.2).
 */
export const selectLanguage = async (
  page: Page,
  language: SupportedLanguage,
): Promise<void> => {
  await languageSelect(page).selectOption(language);
};

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

/** Observes the surface produced by the extension action activation. */
export const extensionAction = (page: Page): Locator =>
  transientFeature(page, "product-capture");

/** Locates a mounted transient feature and never relies on navigation metadata. */
export const transientFeature = (page: Page, featureId: string): Locator =>
  featureRoot(page, featureId);

/** Locates a mounted persistent feature after handoff or fallback. */
export const persistentFeature = (page: Page, featureId: string): Locator =>
  featureRoot(page, featureId);

/** Locates the canonical candidate editor reached after capture handoff. */
export const candidateEditor = (page: Page): Locator =>
  region(persistentFeature(page, "candidate-management"), "candidate-form");

/** Locates the project-required recovery surface for an unresolved draft. */
export const projectRequired = (page: Page): Locator =>
  region(persistentFeature(page, "candidate-management"), "project-required");

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

/** Locates the delete affordance for a candidate row. */
export const deleteCandidateButton = (candidateRow: Locator): Locator =>
  candidateRow.locator("[data-delete-candidate-id]");

/** Locates the source fieldset in the candidate editor. */
export const candidateSources = (editor: Locator): Locator =>
  region(editor, "candidate-sources");

/** Locates all source rows in their persisted editor order. */
export const candidateSourceRows = (sources: Locator): Locator =>
  sources.locator("[data-source-id]");

/** Locates one indexed source field while keeping DOM naming knowledge centralized. */
export const candidateSourceField = (
  sourceRow: Locator,
  index: number,
  name: CandidateSourceFieldName,
): Locator => sourceRow.locator(`[name="source-${index}-${name}"]`);

/** Locates the source-add affordance without depending on translated text. */
export const addCandidateSourceButton = (sources: Locator): Locator =>
  action(sources, "add-candidate-source");

/** Locates a detail-row source revisit affordance. */
export const openCandidateSourceButton = (sourceRow: Locator): Locator =>
  action(sourceRow, "open-candidate-source");

/** Locates a candidate-list primary-source revisit affordance. */
export const openPrimaryCandidateSourceButton = (
  candidateRow: Locator,
): Locator => candidateRow.locator("[data-open-primary-source-id]");

/** Locates the primary selector within one source row. */
export const primaryCandidateSourceInput = (sourceRow: Locator): Locator =>
  sourceRow.locator('input[name="candidate-primary-source"]');

/** Locates the deletion confirmation affordance in the deletion dialog. */
export const confirmDeletionButton = (page: Page): Locator =>
  page.locator("[data-confirm-deletion]");

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
