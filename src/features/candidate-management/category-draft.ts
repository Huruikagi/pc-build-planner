import type { PartCategory } from "../../domain/public.js";
import type { CandidateDraft } from "./contracts.js";

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
