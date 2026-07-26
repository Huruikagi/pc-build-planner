import type { PartCategory } from "../../domain/public.js";
import { JA_CATEGORY_KEYWORDS } from "./locale/ja-category-keywords.js";

/**
 * Best-effort mapping from a free-text category label (JSON-LD `category`,
 * breadcrumb segment, ...) to a `PartCategory`. This never *confirms* a
 * category: it only produces a non-binding suggestion that seeds the detail
 * editor's default selection, so Requirement 3.6 ("推測で確定しない") is kept —
 * the value becomes formal only after the user ratifies it in the editor.
 *
 * The keyword dictionary itself is locale-specific data (currently Japanese
 * only, ordered most-specific first); see `locale/ja-category-keywords.ts`
 * for why it lives apart from this matching logic.
 */

/**
 * Returns a suggested `PartCategory` for a raw label, or `undefined` when no
 * keyword matches confidently. Matching is case-insensitive substring; the
 * caller must treat the result as a hint, never as a confirmed category.
 */
export const inferCategoryHint = (
  raw: string | undefined,
): PartCategory | undefined => {
  if (raw === undefined) return undefined;
  const haystack = raw.toLowerCase();
  if (haystack.trim().length === 0) return undefined;
  for (const [category, keywords] of JA_CATEGORY_KEYWORDS) {
    if (keywords.some((keyword) => haystack.includes(keyword))) {
      return category;
    }
  }
  return undefined;
};
