import type { TargetTabId } from "../../application-shell/public.js";
import type {
  MoneyValue,
  Result,
  SourcedValue,
  UtcTimestamp,
} from "../../domain/public.js";
import {
  type ManufacturerDomainMap,
  manufacturerDomainMap,
} from "./manufacturer-domain-map.js";

export {
  productCaptureFeatureId,
  productCaptureWorkerContribution,
} from "./worker-public.js";

/** Minimal read-only seam consumed by source classifiers in adjacent features. */
export type ManufacturerDomainLookup = Pick<
  ManufacturerDomainMap,
  "findManufacturer"
>;

export interface PagePriceObservation {
  readonly pageUrl: string;
  readonly capturedAt: UtcTimestamp;
  readonly price?: SourcedValue<MoneyValue>;
}

export type PagePriceExtractionError =
  | { readonly kind: "tab-unavailable" }
  | { readonly kind: "permission-lost" }
  | { readonly kind: "restricted-page" }
  | { readonly kind: "tab-changed" }
  | { readonly kind: "injection-failed" }
  | { readonly kind: "invalid-payload" };

export interface PagePriceExtractionPort {
  extractPrice(
    tabId: TargetTabId,
  ): Promise<Result<PagePriceObservation, PagePriceExtractionError>>;
}

export interface ProductCapturePublicApi {
  readonly manufacturerDomains: ManufacturerDomainLookup;
  readonly pagePriceExtraction: PagePriceExtractionPort;
}

export interface ProductCapturePublicDependencies {
  readonly manufacturerDomains?: ManufacturerDomainLookup;
  readonly pagePriceExtraction?: PagePriceExtractionPort;
}

const unavailablePriceExtraction: PagePriceExtractionPort = Object.freeze({
  async extractPrice() {
    return {
      ok: false as const,
      error: { kind: "tab-unavailable" as const },
    };
  },
});

export const createProductCapturePublicApi = (
  dependencies: ProductCapturePublicDependencies = {},
): ProductCapturePublicApi => {
  const lookup = dependencies.manufacturerDomains ?? manufacturerDomainMap;
  const manufacturerDomains: ManufacturerDomainLookup = Object.freeze({
    findManufacturer: lookup.findManufacturer.bind(lookup),
  });
  const pagePriceExtraction: PagePriceExtractionPort = Object.freeze({
    extractPrice: (
      dependencies.pagePriceExtraction ?? unavailablePriceExtraction
    ).extractPrice.bind(
      dependencies.pagePriceExtraction ?? unavailablePriceExtraction,
    ),
  });
  return Object.freeze({ manufacturerDomains, pagePriceExtraction });
};
