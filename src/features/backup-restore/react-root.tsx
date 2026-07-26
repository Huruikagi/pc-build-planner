import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { LanguageProvider } from "../../ui-language/public.js";
import type { BackupRestoreState } from "./state.js";
import { BackupRestoreView } from "./view.js";

export interface BackupRestoreReactRoot {
  unmount(): void;
}

/** Connects feature-owned state to a React root and owns only that root's cleanup. */
export const mountBackupRestoreReactRoot = (
  container: HTMLElement,
  state: BackupRestoreState,
): BackupRestoreReactRoot => {
  const root: Root = createRoot(container);
  let unmounted = false;
  root.render(
    createElement(
      LanguageProvider,
      null,
      createElement(BackupRestoreView, { state }),
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
