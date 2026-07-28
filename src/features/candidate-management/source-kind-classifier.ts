import type { CandidateSourceKind } from "../../domain/public.js";
import type { ManufacturerDomainLookup } from "../product-capture/public.js";

export interface SourceKindClassifier {
  classify(pageUrl: string): CandidateSourceKind;
}

export const createSourceKindClassifier = (
  lookup: ManufacturerDomainLookup,
): SourceKindClassifier => ({
  classify(pageUrl) {
    const result = lookup.findManufacturer(pageUrl);
    return result.ok && result.value !== undefined ? "manufacturer" : "retail";
  },
});

export const resolveSourceKind = (
  pageUrl: string,
  explicitKind: CandidateSourceKind | undefined,
  classifier: SourceKindClassifier,
): CandidateSourceKind => explicitKind ?? classifier.classify(pageUrl);
