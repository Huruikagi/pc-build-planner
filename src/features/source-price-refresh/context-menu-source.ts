import {
  parseTargetTabId,
  type TargetTabId,
  type TransientGestureRegistrationError,
  type TransientGestureSource,
  type TransientMenuApi,
  type TransientMenuClickEvent,
  type TransientMenuClickListener,
  type TransientMenuGestureDependencies,
  type TransientMenuItemProperties,
} from "../../application-shell/worker-public.js";
import { err, ok, type Result } from "../../domain/public.js";
import { sourcePriceRefreshFeatureId } from "./feature-id.js";

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

/**
 * The narrow slice of `chrome.contextMenus` this adapter needs is the shell's
 * own worker-safe menu port, so the worker catalog can type this factory
 * without reaching into the feature. The aliases keep the Chrome-facing names
 * this adapter and its callers already use.
 *
 * `readLastError` reads `chrome.runtime.lastError` inside a Chrome callback:
 * `contextMenus` reports failures there instead of throwing, and an unread
 * `lastError` makes Chrome log a warning, so the expected "item did not exist"
 * result of the idempotent remove is consumed rather than surfaced.
 */
export type ChromeContextMenuCreateProperties = TransientMenuItemProperties;
export type ChromeContextMenuClickListener = TransientMenuClickListener;
export type ChromeContextMenuClickEvent = TransientMenuClickEvent;
export type ChromeContextMenusApi = TransientMenuApi;
export type PriceRefreshContextMenuDependencies =
  TransientMenuGestureDependencies;

const clickedMenuItemId = (info: unknown): unknown =>
  typeof info === "object" && info !== null
    ? (info as { readonly menuItemId?: unknown }).menuItemId
    : undefined;

const clickedTabId = (tab: unknown): unknown =>
  typeof tab === "object" && tab !== null
    ? (tab as { readonly id?: unknown }).id
    : undefined;

type MenuMutation = (complete: () => void) => void;

interface MenuLifecycle {
  currentLease: symbol | undefined;
  readonly pending: MenuMutation[];
  running: boolean;
}

/**
 * Serializes mutations for each concrete Chrome menu API within one worker
 * realm. A fresh MV3 worker gets a fresh map and first removes Chrome's
 * persisted item; overlapping bootstraps in the same realm share a lease so a
 * stale cleanup or callback cannot mutate the current generation's item.
 */
const menuLifecycles = new WeakMap<TransientMenuApi, MenuLifecycle>();

const lifecycleFor = (contextMenus: TransientMenuApi): MenuLifecycle => {
  const existing = menuLifecycles.get(contextMenus);
  if (existing !== undefined) return existing;
  const created: MenuLifecycle = {
    currentLease: undefined,
    pending: [],
    running: false,
  };
  menuLifecycles.set(contextMenus, created);
  return created;
};

const enqueueMenuMutation = (
  lifecycle: MenuLifecycle,
  mutation: MenuMutation,
): void => {
  lifecycle.pending.push(mutation);
  const drain = () => {
    if (lifecycle.running) return;
    const next = lifecycle.pending.shift();
    if (next === undefined) return;
    lifecycle.running = true;
    let completed = false;
    next(() => {
      if (completed) return;
      completed = true;
      lifecycle.running = false;
      drain();
    });
  };
  drain();
};

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
    const consumeCallbackError = () => readLastError?.();
    const lifecycle = lifecycleFor(contextMenus);
    const lease = Symbol(priceRefreshContextMenuItemId);
    lifecycle.currentLease = lease;
    let active = true;
    let creationFailed = false;

    const listener: ChromeContextMenuClickListener = (info, tab) => {
      if (clickedMenuItemId(info) !== priceRefreshContextMenuItemId) return;
      const tabId = parseTargetTabId(clickedTabId(tab));
      if (!tabId.ok) return;
      // Only the pinned tab crosses this boundary: page URL, selection, link
      // and frame data stay inside Chrome's event payload.
      emit(tabId.value);
    };
    const failClosed = () => {
      creationFailed = true;
      active = false;
      if (lifecycle.currentLease === lease) lifecycle.currentLease = undefined;
      contextMenus.onClicked.removeListener(listener);
    };

    try {
      contextMenus.onClicked.addListener(listener);
      /**
       * Chrome persists menu items across worker restarts. Remove and create
       * are one serialized mutation: starting a newer lease invalidates every
       * callback from the older generation before it can recreate the item.
       */
      enqueueMenuMutation(lifecycle, (complete) => {
        try {
          contextMenus.remove(priceRefreshContextMenuItemId, () => {
            let removalError: unknown;
            try {
              removalError = consumeCallbackError();
              if (!active || lifecycle.currentLease !== lease) {
                complete();
                return;
              }
              contextMenus.create(
                {
                  id: priceRefreshContextMenuItemId,
                  title: dependencies.title,
                  contexts: MENU_CONTEXTS,
                  documentUrlPatterns: MENU_DOCUMENT_URL_PATTERNS,
                },
                () => {
                  try {
                    const creationError = consumeCallbackError();
                    // Synchronous test doubles can expose the outer remove
                    // callback's lastError to a nested create callback. Chrome
                    // invokes these callbacks in distinct error scopes, so an
                    // identical object is the already-consumed remove result.
                    if (
                      creationError !== undefined &&
                      creationError !== removalError
                    )
                      failClosed();
                  } catch {
                    failClosed();
                  } finally {
                    complete();
                  }
                },
              );
            } catch {
              failClosed();
              complete();
            }
          });
        } catch {
          failClosed();
          complete();
        }
      });
    } catch {
      active = false;
      if (lifecycle.currentLease === lease) lifecycle.currentLease = undefined;
      return err({ kind: "source-start-failed" });
    }
    if (creationFailed) return err({ kind: "source-start-failed" });

    return ok(() => {
      if (!active) return;
      active = false;
      contextMenus.onClicked.removeListener(listener);
      enqueueMenuMutation(lifecycle, (complete) => {
        if (lifecycle.currentLease !== lease) {
          complete();
          return;
        }
        lifecycle.currentLease = undefined;
        try {
          contextMenus.remove(priceRefreshContextMenuItemId, () => {
            try {
              consumeCallbackError();
            } finally {
              complete();
            }
          });
        } catch {
          complete();
        }
      });
    });
  },
});
