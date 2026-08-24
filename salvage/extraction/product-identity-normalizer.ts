import type { SourcedValue } from "../../domain/public.js";
import { normalizeWhitespaceAndControlCharacters } from "./normalizer.js";

export type ProductIdentityField = "name" | "manufacturer" | "model-number";

export interface ProductIdentityNormalizer {
  normalize(
    field: ProductIdentityField,
    value: SourcedValue<string> | undefined,
  ): string | undefined;
}

const MODEL_NUMBER_SEPARATORS = /[\s_-]+/gu;

const selectComparisonValue = (
  value: SourcedValue<string> | undefined,
): string | undefined => {
  if (value === undefined) return undefined;
  return value.confirmed !== undefined
    ? value.confirmed
    : (value.original ?? undefined);
};

export const createProductIdentityNormalizer =
  (): ProductIdentityNormalizer => ({
    normalize(field, value) {
      const selected = selectComparisonValue(value);
      if (selected === undefined) return undefined;

      const { text } = normalizeWhitespaceAndControlCharacters(selected);
      const normalized = text.normalize("NFKC").toLowerCase();
      const comparisonKey =
        field === "model-number"
          ? normalized.replace(MODEL_NUMBER_SEPARATORS, "")
          : normalized;

      return comparisonKey.length > 0 ? comparisonKey : undefined;
    },
  });
