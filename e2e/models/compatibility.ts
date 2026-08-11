import type { Locator } from "@playwright/test";

export const compatibilityState = (feature: Locator): Locator =>
  feature.locator("[data-status]");

export const compatibilityResult = (
  feature: Locator,
  status: "compatible" | "incompatible" | "unknown",
): Locator => feature.locator(`[data-result-status="${status}"]`);
