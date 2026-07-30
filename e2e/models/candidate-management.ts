import type { Locator, Page } from "@playwright/test";

import { persistentFeature } from "./application-shell.js";
import { action, region } from "./locator-primitives.js";

export type CandidateSourceFieldName =
  | "captured-at"
  | "kind"
  | "site-name"
  | "url";

/** Locates the canonical candidate editor reached after capture handoff. */
export const candidateEditor = (page: Page): Locator =>
  region(persistentFeature(page, "candidate-management"), "candidate-form");

/** Locates the recovery surface for an unresolved project draft. */
export const projectRequired = (page: Page): Locator =>
  region(persistentFeature(page, "candidate-management"), "project-required");

export const createCandidateButton = (feature: Locator): Locator =>
  feature.locator("[data-create-candidate]");

export const editCandidateButton = (candidateRow: Locator): Locator =>
  candidateRow.locator("[data-edit-candidate-id]");

export const deleteCandidateButton = (candidateRow: Locator): Locator =>
  candidateRow.locator("[data-delete-candidate-id]");

export const candidateSources = (editor: Locator): Locator =>
  region(editor, "candidate-sources");

export const candidateSourceRows = (sources: Locator): Locator =>
  sources.locator("[data-source-id]");

export const candidateSourceField = (
  sourceRow: Locator,
  index: number,
  name: CandidateSourceFieldName,
): Locator => sourceRow.locator(`[name="source-${index}-${name}"]`);

export const addCandidateSourceButton = (sources: Locator): Locator =>
  action(sources, "add-candidate-source");

export const openCandidateSourceButton = (sourceRow: Locator): Locator =>
  action(sourceRow, "open-candidate-source");

export const openPrimaryCandidateSourceButton = (
  candidateRow: Locator,
): Locator => candidateRow.locator("[data-open-primary-source-id]");

export const primaryCandidateSourceInput = (sourceRow: Locator): Locator =>
  sourceRow.locator('input[name="candidate-primary-source"]');

export const confirmDeletionButton = (page: Page): Locator =>
  page.locator("[data-confirm-deletion]");
