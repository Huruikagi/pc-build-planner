import type { CaptureCoreField } from "./contracts.js";

/**
 * The metadata families this feature distinguishes. Each family is adopted
 * property by property; a namespace is never adopted as a whole.
 */
export type MetadataNamespace = "open-graph" | "twitter-card" | "product";

/**
 * Where an allowlisted property is adopted.
 *
 * `source-site-name` is the optional display-name channel and is deliberately
 * not a `CaptureField`, so it can never reach the required-item set or the
 * missing-core-field list. `price-currency` qualifies the `price` target rather
 * than standing on its own, so the currency of a price stays an explicitly
 * listed combination instead of an implicit sibling lookup.
 */
export type MetadataPropertyTarget =
  | CaptureCoreField
  | "source-site-name"
  | "price-currency";

export interface MetadataPropertyRule {
  readonly namespace: MetadataNamespace;
  readonly property: string;
  readonly target: MetadataPropertyTarget;
}

const MAX_METADATA_PROPERTY_LENGTH = 100;
const CONTROL_CHARACTER = /\p{Cc}/u;

/**
 * The complete set of metadata combinations this feature may adopt. Widening
 * it changes the acquisition scope, so additions are re-reviewed against
 * `web-content-acquisition.md` rather than added alongside a page fix.
 */
export const METADATA_PROPERTY_RULES: readonly MetadataPropertyRule[] =
  Object.freeze([
    { namespace: "open-graph", property: "og:title", target: "name" },
    { namespace: "open-graph", property: "og:url", target: "url" },
    {
      namespace: "open-graph",
      property: "og:site_name",
      target: "source-site-name",
    },
    { namespace: "twitter-card", property: "twitter:title", target: "name" },
    { namespace: "product", property: "product:brand", target: "manufacturer" },
    {
      namespace: "product",
      property: "product:retailer_item_id",
      target: "modelNumber",
    },
    {
      namespace: "product",
      property: "product:price:amount",
      target: "price",
    },
    {
      namespace: "product",
      property: "product:price:currency",
      target: "price-currency",
    },
  ] as const satisfies readonly MetadataPropertyRule[]);

/**
 * Case and surrounding whitespace are presentation noise in a metadata
 * attribute, so they are folded away. Width and compatibility folding are not
 * applied: `NFKC` would map a full-width lookalike onto a listed property and
 * turn a spoofed attribute into an accepted one.
 */
export const normalizeMetadataProperty = (value: string): string =>
  value.trim().toLowerCase();

const RULES_BY_PROPERTY = new Map<string, MetadataPropertyRule>();
for (const rule of METADATA_PROPERTY_RULES) {
  if (RULES_BY_PROPERTY.has(rule.property)) {
    throw new Error("Duplicate metadata property rule");
  }
  RULES_BY_PROPERTY.set(rule.property, rule);
}

/**
 * Resolves a page-supplied property name to its rule, or `undefined` when the
 * combination is not listed. Matching is exact on the normalized name: a
 * shared prefix, a shared suffix, or a known namespace is never enough.
 */
export const findMetadataPropertyRule = (
  property: string,
): MetadataPropertyRule | undefined => {
  if (
    property.length > MAX_METADATA_PROPERTY_LENGTH ||
    CONTROL_CHARACTER.test(property)
  ) {
    return undefined;
  }
  return RULES_BY_PROPERTY.get(normalizeMetadataProperty(property));
};
