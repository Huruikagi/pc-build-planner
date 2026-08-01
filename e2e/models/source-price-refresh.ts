import type { Locator, Page } from "@playwright/test";

import { transientFeature } from "./application-shell.js";

export const sourcePriceRefresh = (page: Page): Locator =>
  transientFeature(page, "source-price-refresh");

export const sourcePriceRefreshStatus = (surface: Locator): Locator =>
  surface.locator("[data-status]");

export const sourcePriceRefreshField = (
  surface: Locator,
  field: "price" | "captured-at" | "primary",
): Locator => surface.locator(`[data-field="${field}"]`);

export const sourcePriceRefreshFailureCause = (surface: Locator): Locator =>
  surface.locator('[data-region="cause"]');

export const sourcePriceRefreshGuidance = (surface: Locator): Locator =>
  surface.locator('[data-region="recovery-guidance"]');

export const sourcePriceRefreshPreserved = (surface: Locator): Locator =>
  surface.locator('[data-region="preserved"]');
