import type { Locator, Page } from "@playwright/test";

/** Locates the application shell runtime root. */
export const applicationShell = (page: Page): Locator =>
  page.locator("#application-shell");

/** Locates a feature's shell-owned root by its stable registration id. */
export const featureRoot = (page: Page, featureId: string): Locator =>
  page.locator(`.shell-feature[data-feature-id="${featureId}"]`);

/** Locates a mounted transient feature without relying on navigation data. */
export const transientFeature = (page: Page, featureId: string): Locator =>
  featureRoot(page, featureId);

/** Locates a mounted persistent feature after handoff or fallback. */
export const persistentFeature = (page: Page, featureId: string): Locator =>
  featureRoot(page, featureId);

/** Locates a shell navigation item by feature id. */
export const navItem = (page: Page, featureId: string): Locator =>
  page.locator(`.shell-navigation [data-feature-id="${featureId}"]`);

/** Locates all persistent navigation items. */
export const persistentNavigationItems = (page: Page): Locator =>
  page.locator(".shell-navigation [data-feature-id]");

/** Locates the document body for whole-page message assertions. */
export const documentBody = (page: Page): Locator => page.locator("body");

/** Locates the document root for document-level language assertions. */
export const documentRoot = (page: Page): Locator => page.locator("html");
