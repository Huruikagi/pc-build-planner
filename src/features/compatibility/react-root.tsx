import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { LanguageProvider } from "../../ui-language/public.js";
import type { CompatibilityState } from "./state.js";
import { CompatibilityView } from "./view.js";

export interface CompatibilityReactRoot {
  unmount(): void;
}

/** Connects feature-owned state to a React root and owns only that root's cleanup. */
export const mountCompatibilityReactRoot = (
  container: HTMLElement,
  state: CompatibilityState,
  startProjectTracking = false,
): CompatibilityReactRoot => {
  const root: Root = createRoot(container);
  let unmounted = false;
  try {
    root.render(
      createElement(
        LanguageProvider,
        null,
        createElement(CompatibilityView, { state }),
      ),
    );
    if (startProjectTracking) state.start();
  } catch (error) {
    try {
      state.stop();
    } finally {
      try {
        root.unmount();
      } finally {
        container.replaceChildren();
      }
    }
    throw error;
  }
  return {
    unmount() {
      if (unmounted) return;
      unmounted = true;
      try {
        state.stop();
      } finally {
        try {
          root.unmount();
        } finally {
          container.replaceChildren();
        }
      }
    },
  };
};
