import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { LanguageProvider } from "../../ui-language/public.js";
import type { SourcePriceRefreshState } from "./state.js";
import { SourcePriceRefreshView } from "./view.js";

export interface SourcePriceRefreshReactRootDependencies {
  readonly state: SourcePriceRefreshState;
}

export interface SourcePriceRefreshReactRoot {
  unmount(): void;
}

/**
 * Connects the feature-owned refresh state to a React root and owns only that
 * root's cleanup. The state itself outlives no mount: the registration creates
 * one per activation and releases it alongside this root.
 */
export const mountSourcePriceRefreshReactRoot = (
  container: HTMLElement,
  dependencies: SourcePriceRefreshReactRootDependencies,
): SourcePriceRefreshReactRoot => {
  const root: Root = createRoot(container);
  let unmounted = false;
  root.render(
    createElement(
      LanguageProvider,
      null,
      createElement(SourcePriceRefreshView, { state: dependencies.state }),
    ),
  );
  return {
    unmount() {
      if (unmounted) return;
      unmounted = true;
      root.unmount();
      container.replaceChildren();
    },
  };
};
