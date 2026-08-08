import type { Locator, Page } from "@playwright/test";

/** Stable downstream locator contract for the shared project selector. */
export const projectContextSelector = (scope: Page | Locator): Locator =>
  scope.locator("[data-project-context='selector']");

export const projectContextSelect = (scope: Page | Locator): Locator =>
  scope.locator("[data-project-context='select']");

export const projectContextStatus = (scope: Page | Locator): Locator =>
  scope.getByRole("status");

export const projectContextRetry = (scope: Page | Locator): Locator =>
  scope.locator("[data-project-context='retry']");

export const projectContextConfirmation = (scope: Page | Locator): Locator =>
  scope.locator("[role='dialog'][aria-modal='true']");
