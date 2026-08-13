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
  projectContextSelector(scope).getByRole("status");

export const projectContextRetry = (scope: Page | Locator): Locator =>
  scope.locator("[data-project-context='retry']");

export const projectContextConfirmation = (scope: Page | Locator): Locator =>
  scope.locator("[role='dialog'][aria-modal='true']");

export const confirmProjectContextSwitch = (scope: Page | Locator): Locator =>
  projectContextConfirmation(scope).getByRole("button").first();

export const cancelProjectContextSwitch = (scope: Page | Locator): Locator =>
  scope.locator("[data-project-context='cancel']");

/** Stable downstream host contract for the project lifecycle contribution. */
export const projectLifecycleHost = (scope: Page | Locator): Locator =>
  scope.locator("[data-project-lifecycle-host='true']");

export const projectLifecyclePresentation = (scope: Page | Locator): Locator =>
  projectLifecycleHost(scope).locator(
    "[data-project-lifecycle='presentation']",
  );

export const projectLifecycleStatus = (scope: Page | Locator): Locator =>
  projectLifecyclePresentation(scope).getByRole("status");
