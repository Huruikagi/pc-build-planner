import { createElement, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import type { OperationPolicy } from "../../application-shell/public.js";
import { LanguageProvider } from "../../ui-language/public.js";
import { backupRestoreMutationOperation } from "./operation-kind.js";
import type { BackupRestoreState } from "./state.js";
import { BackupRestoreView } from "./view.js";

export interface BackupRestoreReactRoot {
  unmount(): void;
}

const PolicyAwareBackupRestoreView = ({
  state,
  operationPolicy,
}: {
  readonly state: BackupRestoreState;
  readonly operationPolicy?: OperationPolicy;
}) => {
  const mutationAllowed = useSyncExternalStore(
    (listener) => operationPolicy?.subscribe(listener) ?? (() => {}),
    () => operationPolicy?.isAllowed(backupRestoreMutationOperation) ?? true,
    () => operationPolicy?.isAllowed(backupRestoreMutationOperation) ?? true,
  );
  return createElement(BackupRestoreView, { state, mutationAllowed });
};

/** Connects feature-owned state to a React root and owns only that root's cleanup. */
export const mountBackupRestoreReactRoot = (
  container: HTMLElement,
  state: BackupRestoreState,
  operationPolicy?: OperationPolicy,
): BackupRestoreReactRoot => {
  let mountError: unknown;
  const root: Root = createRoot(container, {
    onUncaughtError(error) {
      mountError = error;
    },
  });
  let unmounted = false;
  try {
    flushSync(() => {
      root.render(
        createElement(
          LanguageProvider,
          null,
          createElement(PolicyAwareBackupRestoreView, {
            state,
            ...(operationPolicy === undefined ? {} : { operationPolicy }),
          }),
        ),
      );
    });
    if (mountError !== undefined) throw mountError;
  } catch (error) {
    try {
      root.unmount();
      container.replaceChildren();
      unmounted = true;
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Backup restore root mount rollback failed",
      );
    }
    throw error;
  }
  return {
    unmount() {
      if (unmounted) return;
      root.unmount();
      container.replaceChildren();
      unmounted = true;
    },
  };
};
