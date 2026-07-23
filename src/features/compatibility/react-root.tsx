import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { CompatibilityState } from "./state.js";
import { CompatibilityView } from "./view.js";

export interface CompatibilityReactRoot {
  unmount(): void;
}

/** Connects feature-owned state to a React root and owns only that root's cleanup. */
export const mountCompatibilityReactRoot = (
  container: HTMLElement,
  state: CompatibilityState,
): CompatibilityReactRoot => {
  const root: Root = createRoot(container);
  let unmounted = false;
  root.render(createElement(CompatibilityView, { state }));
  return {
    unmount() {
      if (unmounted) return;
      unmounted = true;
      root.unmount();
      container.replaceChildren();
    },
  };
};
