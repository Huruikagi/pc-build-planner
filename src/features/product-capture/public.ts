import type { FeatureId } from "../../application-shell/public.js";
import {
  type ManufacturerDomainMap,
  manufacturerDomainMap,
} from "./manufacturer-domain-map.js";

export const productCaptureFeatureId = "product-capture" as FeatureId;

/** Minimal read-only seam consumed by source classifiers in adjacent features. */
export type ManufacturerDomainLookup = Pick<
  ManufacturerDomainMap,
  "findManufacturer"
>;

export interface ProductCapturePublicApi {
  readonly manufacturerDomains: ManufacturerDomainLookup;
}

export interface ProductCapturePublicDependencies {
  readonly manufacturerDomains?: ManufacturerDomainLookup;
}

export const createProductCapturePublicApi = (
  dependencies: ProductCapturePublicDependencies = {},
): ProductCapturePublicApi => {
  const lookup = dependencies.manufacturerDomains ?? manufacturerDomainMap;
  const manufacturerDomains: ManufacturerDomainLookup = Object.freeze({
    findManufacturer: lookup.findManufacturer.bind(lookup),
  });
  return Object.freeze({ manufacturerDomains });
};
