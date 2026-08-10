import type { Locator, Page } from "@playwright/test";

/** Stable downstream locator contract for the shared project selector. */
export const projectContextSelector = (scope: Page | Locator): Locator =>
  scope.locator("[data-project-context='selector']");

export const projectContextSelect = (scope: Page | Locator): Locator =>
  scope.locator("[data-project-context='select']");

export const projectContextOptions = (scope: Page | Locator): Locator =>
  projectContextSelect(scope).locator("option");

export const projectContextOption = (
  scope: Page | Locator,
  name: string,
): Locator => projectContextOptions(scope).filter({ hasText: name });

export const selectedProjectContextOption = (scope: Page | Locator): Locator =>
  projectContextSelect(scope).locator("option:checked");

export const projectContextStatus = (scope: Page | Locator): Locator =>
  scope.getByRole("status");

export const projectContextRetry = (scope: Page | Locator): Locator =>
  scope.locator("[data-project-context='retry']");

export const projectContextConfirmation = (scope: Page | Locator): Locator =>
  scope.locator("[role='dialog'][aria-modal='true']");

export const confirmProjectContextSwitch = (scope: Page | Locator): Locator =>
  projectContextConfirmation(scope).getByRole("button").first();

export const cancelProjectContextSwitch = (scope: Page | Locator): Locator =>
  scope.locator("[data-project-context='cancel']");
