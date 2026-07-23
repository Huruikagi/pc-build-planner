import type { FeatureId } from "../../application-shell/public.js";

export const productCaptureFeatureId = "product-capture" as FeatureId;

/** No other feature consumes capture; this exists as the required single public entry point. */
export type ProductCapturePublicApi = Record<string, never>;

export const createProductCapturePublicApi = (): ProductCapturePublicApi =>
  Object.freeze({});
