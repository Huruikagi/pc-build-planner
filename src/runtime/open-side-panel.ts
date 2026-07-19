import { err, ok, type Result } from "../domain/public.js";

export type SidePanelOpenOptions =
  | { readonly tabId: number; readonly windowId?: never }
  | { readonly tabId?: never; readonly windowId: number };

export interface ChromeSidePanelOpenApi {
  open(options: SidePanelOpenOptions): Promise<void>;
}

export interface SidePanelOpenDiagnostic {
  readonly code: "side-panel-open-failed";
  readonly message: "Side panelを開けませんでした。";
}

export type SidePanelOpenResult = Result<undefined, SidePanelOpenDiagnostic>;

export type OpenSidePanelGestureHandler = (
  options: SidePanelOpenOptions,
) => Promise<SidePanelOpenResult>;

const openFailed = (): SidePanelOpenResult =>
  err({
    code: "side-panel-open-failed",
    message: "Side panelを開けませんでした。",
  });

/**
 * This handler must be invoked directly from a user gesture listener. It starts
 * the Chrome call before returning; side-panel host readiness is intentionally
 * outside this adapter and must not be awaited before invoking the handler.
 */
export const createOpenSidePanelGestureHandler =
  (sidePanel: ChromeSidePanelOpenApi): OpenSidePanelGestureHandler =>
  (options) => {
    let opening: Promise<void>;
    try {
      opening = sidePanel.open(options);
    } catch (_error: unknown) {
      return Promise.resolve(openFailed());
    }

    return opening.then(
      () => ok(undefined),
      (_error: unknown) => openFailed(),
    );
  };
