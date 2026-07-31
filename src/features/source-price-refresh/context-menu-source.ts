import {
  parseTargetTabId,
  type TargetTabId,
  type TransientGestureRegistrationError,
  type TransientGestureSource,
} from "../../application-shell/public.js";
import { err, ok, type Result } from "../../domain/public.js";
import { sourcePriceRefreshFeatureId } from "./public.js";

/** Stable menu item ID, so a restarted worker re-registers the same item. */
export const priceRefreshContextMenuItemId = "source-price-refresh";

const MENU_CONTEXTS = ["page"] as const;

/**
 * The item is offered on ordinary web documents only. This is the sole place
 * restricted pages are excluded: the click listener must not inspect page URLs,
 * so Chrome's own pattern matching is what keeps the item off `chrome://`,
 * extension and file documents.
 */
const MENU_DOCUMENT_URL_PATTERNS = ["http://*/*", "https://*/*"] as const;

export interface ChromeContextMenuCreateProperties {
  readonly id: string;
  readonly title: string;
  readonly contexts: readonly string[];
  readonly documentUrlPatterns: readonly string[];
}

export type ChromeContextMenuClickListener = (
  info: unknown,
  tab?: unknown,
) => void;

export interface ChromeContextMenuClickEvent {
  addListener(listener: ChromeContextMenuClickListener): void;
  removeListener(listener: ChromeContextMenuClickListener): void;
}

/**
 * The narrow slice of `chrome.contextMenus` this adapter needs. `info` and
 * `tab` stay `unknown` so every runtime payload is validated at this boundary.
 */
export interface ChromeContextMenusApi {
  create(
    properties: ChromeContextMenuCreateProperties,
    callback?: () => void,
  ): unknown;
  remove(menuItemId: string, callback?: () => void): unknown;
  readonly onClicked: ChromeContextMenuClickEvent;
}

export interface PriceRefreshContextMenuDependencies {
  readonly contextMenus: ChromeContextMenusApi;
  /** Resolved menu label. The message catalog owns the wording, not this adapter. */
  readonly title: string;
  /**
   * Reads `chrome.runtime.lastError` inside a Chrome callback. `contextMenus`
   * reports failures there instead of throwing, and an unread `lastError` makes
   * Chrome log a warning, so the expected "item did not exist" result of the
   * idempotent remove is consumed rather than surfaced.
   */
  readonly readLastError?: () => unknown;
}

const clickedMenuItemId = (info: unknown): unknown =>
  typeof info === "object" && info !== null
    ? (info as { readonly menuItemId?: unknown }).menuItemId
    : undefined;

const clickedTabId = (tab: unknown): unknown =>
  typeof tab === "object" && tab !== null
    ? (tab as { readonly id?: unknown }).id
    : undefined;

/**
 * Feature-owned context menu gesture source. It contributes one menu item and
 * forwards a validated click as a synchronous tab emit; the upstream gesture
 * registration owns sequencing, the activation record and any panel opening.
 * Nothing here touches the DOM, React or the extension's storage, so the module
 * stays loadable from the service worker.
 */
export const createPriceRefreshContextMenuSource = (
  dependencies: PriceRefreshContextMenuDependencies,
): TransientGestureSource => ({
  id: sourcePriceRefreshFeatureId,
  surfaceId: sourcePriceRefreshFeatureId,

  start(
    emit: (tabId: TargetTabId) => void,
  ): Result<() => void, TransientGestureRegistrationError> {
    const { contextMenus, readLastError } = dependencies;
    const consumeCallbackError = () => {
      readLastError?.();
    };
    /**
     * Chrome keeps context menu items across service worker restarts and fails
     * a duplicate ID, so registration is made idempotent by removing the stable
     * ID first; a missing item is the normal first-run case.
     */
    const removeItem = () => {
      contextMenus.remove(priceRefreshContextMenuItemId, consumeCallbackError);
    };

    try {
      removeItem();
      contextMenus.create(
        {
          id: priceRefreshContextMenuItemId,
          title: dependencies.title,
          contexts: MENU_CONTEXTS,
          documentUrlPatterns: MENU_DOCUMENT_URL_PATTERNS,
        },
        consumeCallbackError,
      );
    } catch {
      return err({ kind: "source-start-failed" });
    }

    const listener: ChromeContextMenuClickListener = (info, tab) => {
      if (clickedMenuItemId(info) !== priceRefreshContextMenuItemId) return;
      const tabId = parseTargetTabId(clickedTabId(tab));
      if (!tabId.ok) return;
      // Only the pinned tab crosses this boundary: page URL, selection, link
      // and frame data stay inside Chrome's event payload.
      emit(tabId.value);
    };
    contextMenus.onClicked.addListener(listener);

    let active = true;
    return ok(() => {
      if (!active) return;
      active = false;
      contextMenus.onClicked.removeListener(listener);
      removeItem();
    });
  },
});
