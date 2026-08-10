import type { PartCategory, ProjectId } from "../../domain/public.js";
import type {
  CandidateDraft,
  UnresolvedCandidateEditorPrefill,
} from "./contracts.js";

/**
 * Builds the empty, category-coherent `normalizedAttributes` for a category.
 * A `CandidateDraft` is a discriminated union keyed on `category`, so its
 * attributes must always match the selected category; this keeps that pairing
 * in one place for both the editor UI and prefill seeding.
 */
export const attributesFor = (
  category: PartCategory,
): CandidateDraft["normalizedAttributes"] => {
  switch (category) {
    case "cpu":
      return { category, socket: { original: null } };
    case "cpu-cooler":
      return { category, supportedSockets: { original: null } };
    case "motherboard":
      return {
        category,
        socket: { original: null },
        memoryStandard: { original: null },
        formFactor: { original: null },
      };
    case "memory":
      return { category, memoryStandard: { original: null } };
    case "power-supply":
      return { category, formFactor: { original: null } };
    case "case":
      return {
        category,
        supportedMotherboardFormFactors: { original: null },
        supportedPowerSupplyFormFactors: { original: null },
      };
    default:
      return { category };
  }
};

/**
 * Binds a project-unresolved pre-edit to one already validated project. The
 * caller supplies the project; this never chooses one. The category hint is
 * applied only when the draft carries no confirmed category, so an existing
 * formal category always wins over a hint. The seeded draft is unsaved editor
 * state, ratified by the user on save.
 */
export const resolvePreEditDraft = (
  prefill: UnresolvedCandidateEditorPrefill,
  projectId: ProjectId,
): CandidateDraft => {
  const resolved = { ...prefill.draft, projectId } as CandidateDraft;
  return prefill.categoryHint !== undefined &&
    resolved.category === "uncategorized"
    ? withCategory(resolved, prefill.categoryHint)
    : resolved;
};

/** Re-homes a draft onto a new category, resetting attributes to that category's empty shape. */
export const withCategory = (
  draft: CandidateDraft,
  category: PartCategory,
): CandidateDraft =>
  ({
    ...draft,
    category,
    normalizedAttributes: attributesFor(category),
  }) as CandidateDraft;
