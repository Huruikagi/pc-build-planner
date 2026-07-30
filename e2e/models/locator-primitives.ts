import type { Locator, Page } from "@playwright/test";

export type FormFieldName =
  | "attribute-memoryStandard"
  | "attribute-socket"
  | "candidate-category"
  | "candidate-name"
  | "project-name";

/** Locates a page region by its stable, language-independent identifier. */
export const region = (scope: Locator | Page, name: string): Locator =>
  scope.locator(`[data-region="${name}"]`);

/** Locates an action by its stable, language-independent identifier. */
export const action = (scope: Locator | Page, name: string): Locator =>
  scope.locator(`[data-action="${name}"]`);

/** Locates one of the stable named fields used by E2E setup flows. */
export const formField = (
  scope: Locator | Page,
  name: FormFieldName,
): Locator => scope.locator(`[name="${name}"]`);

/** Locates the submit control owned by a form region. */
export const submitButton = (form: Locator): Locator =>
  form.locator('button[type="submit"]');
