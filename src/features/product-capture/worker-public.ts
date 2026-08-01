import type { FeatureId } from "../../application-shell/worker-public.js";

export const productCaptureFeatureId = "product-capture" as FeatureId;

/** Worker-only metadata consumed by the shell-owned worker catalog. */
export const productCaptureWorkerContribution = Object.freeze({
  transientSurfaceId: productCaptureFeatureId,
});
