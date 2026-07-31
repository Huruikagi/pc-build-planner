import type { Locator, Page } from "@playwright/test";

import { transientFeature } from "./application-shell.js";

/** Observes the surface produced by extension action activation. */
export const extensionAction = (page: Page): Locator =>
  transientFeature(page, "product-capture");

export const captureStartButton = (capture: Locator): Locator =>
  capture.locator("[data-capture-start]");

export const captureRetryButton = (capture: Locator): Locator =>
  capture.locator("[data-capture-retry]");

export const captureManualEntryButton = (capture: Locator): Locator =>
  capture.locator("[data-capture-manual]");
