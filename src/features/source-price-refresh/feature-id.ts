import type { FeatureId } from "../../application-shell/worker-public.js";

/**
 * The feature id lives in its own module so the worker-safe context menu
 * adapter can read it without importing `public.ts`, which would close an
 * import cycle through the feature's public entry.
 */
export const sourcePriceRefreshFeatureId = "source-price-refresh" as FeatureId;
