import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { LanguageProvider } from "../../ui-language/public.js";
import type { ManagementState } from "./state.js";
import { ManagementView } from "./view.js";

export interface ManagementReactRoot {
  unmount(): void;
}

/** Connects feature-owned state to a React root and owns only that root's cleanup. */
export const mountManagementReactRoot = (
  container: HTMLElement,
  state: ManagementState,
  _legacyProjectLifecycleOwnedExternally?: boolean,
): ManagementReactRoot => {
  const root: Root = createRoot(container);
  let unmounted = false;
  root.render(
    createElement(
      LanguageProvider,
      null,
      createElement(ManagementView, { state }),
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
