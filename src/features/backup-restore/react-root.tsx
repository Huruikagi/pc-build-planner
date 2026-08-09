import { createElement, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import type { OperationPolicy } from "../../application-shell/public.js";
import { LanguageProvider } from "../../ui-language/public.js";
import {
  backupExportOperation,
  backupRestoreRecoveryOperation,
} from "./operation-kind.js";
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
  const allowedMask = useSyncExternalStore(
    (listener) => operationPolicy?.subscribe(listener) ?? (() => {}),
    () =>
      (operationPolicy?.isAllowed(backupExportOperation) ?? true ? 2 : 0) +
      (operationPolicy?.isAllowed(backupRestoreRecoveryOperation) ?? true
        ? 1
        : 0),
    () =>
      (operationPolicy?.isAllowed(backupExportOperation) ?? true ? 2 : 0) +
      (operationPolicy?.isAllowed(backupRestoreRecoveryOperation) ?? true
        ? 1
        : 0),
  );
  const exportAllowed = (allowedMask & 2) !== 0;
  const restoreAllowed = (allowedMask & 1) !== 0;
  return createElement(BackupRestoreView, {
    state,
    exportAllowed,
    restoreAllowed,
  });
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
