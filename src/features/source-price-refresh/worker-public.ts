import { createPriceRefreshContextMenuSource } from "./context-menu-source.js";
import { sourcePriceRefreshFeatureId } from "./feature-id.js";

/**
 * Worker-only public entry consumed by the shell-owned worker catalog.
 * Keep this graph limited to the menu adapter and its stable feature id.
 */
export const sourcePriceRefreshWorkerContribution = Object.freeze({
  createMenuGestureSource: createPriceRefreshContextMenuSource,
});

export { sourcePriceRefreshFeatureId };
