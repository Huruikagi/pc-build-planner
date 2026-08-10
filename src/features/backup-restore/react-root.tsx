import { createElement, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import type { OperationPolicy } from "../../application-shell/public.js";
import { LanguageProvider } from "../../ui-language/public.js";
import {
  backupReadOperation,
  backupRestoreCommitOperation,
} from "./operation-kind.js";
import type { BackupRestoreState } from "./state.js";
import { BackupRestoreView } from "./view.js";

export interface BackupRestoreReactRoot {
  unmount(): void;
}

/**
 * readとrecoveryは別々のcapabilityであり、片方だけが変化しても同じ購読で観測する。
 * `useSyncExternalStore`は同一参照を要求するため、二値をbit maskへ畳んで比較する。
 */
const allowedMaskOf = (operationPolicy?: OperationPolicy): number =>
  ((operationPolicy?.isAllowed(backupReadOperation) ?? true) ? 2 : 0) +
  ((operationPolicy?.isAllowed(backupRestoreCommitOperation) ?? true) ? 1 : 0);

const PolicyAwareBackupRestoreView = ({
  state,
  operationPolicy,
}: {
  readonly state: BackupRestoreState;
  readonly operationPolicy?: OperationPolicy;
}) => {
  const allowedMask = useSyncExternalStore(
    (listener) => operationPolicy?.subscribe(listener) ?? (() => {}),
    () => allowedMaskOf(operationPolicy),
    () => allowedMaskOf(operationPolicy),
  );
  return createElement(BackupRestoreView, {
    state,
    readAllowed: (allowedMask & 2) !== 0,
    commitAllowed: (allowedMask & 1) !== 0,
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
