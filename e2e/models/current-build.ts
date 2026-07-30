import type { Locator } from "@playwright/test";

export const categoryButton = (build: Locator, category: string): Locator =>
  build.locator(`[data-category="${category}"]`);

export const selectCandidateButton = (candidateRow: Locator): Locator =>
  candidateRow.locator("[data-select-candidate-id]");

export const removeCandidateButton = (candidateRow: Locator): Locator =>
  candidateRow.locator("[data-remove-candidate-id]");

export const quantityInput = (candidateRow: Locator): Locator =>
  candidateRow.locator("input[data-quantity-input]");

export const confirmQuantityButton = (candidateRow: Locator): Locator =>
  candidateRow.locator("[data-confirm-quantity]");
