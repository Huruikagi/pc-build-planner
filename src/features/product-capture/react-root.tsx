import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MessageProvider } from "../../ui-messages/public.js";
import type { CaptureState } from "./state.js";
import { type CaptureProjectOption, CaptureView } from "./view.js";

export interface CaptureReactRootDependencies {
  readonly state: CaptureState;
  readonly projects: readonly CaptureProjectOption[];
  readonly onOpenDetailEdit?: (manualName?: string) => void;
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
      MessageProvider,
      null,
      createElement(CaptureView, {
        state: dependencies.state,
        projects: dependencies.projects,
        ...(dependencies.onOpenDetailEdit === undefined
          ? {}
          : { onOpenDetailEdit: dependencies.onOpenDetailEdit }),
      }),
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
