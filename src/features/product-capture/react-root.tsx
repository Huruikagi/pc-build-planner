import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LanguageProvider } from "../../ui-language/public.js";
import type { CaptureState } from "./state.js";
import { CaptureView } from "./view.js";

export interface CaptureReactRootDependencies {
  readonly state: CaptureState;
}

export interface CaptureReactRoot {
  unmount(): void;
}

/** Connects feature-owned state to a React root and owns only that root's cleanup. */
export const mountCaptureReactRoot = (
  container: HTMLElement,
  dependencies: CaptureReactRootDependencies,
): CaptureReactRoot => {
  const root: Root = createRoot(container);
  let unmounted = false;
  root.render(
    createElement(
      LanguageProvider,
      null,
      createElement(CaptureView, { state: dependencies.state }),
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
