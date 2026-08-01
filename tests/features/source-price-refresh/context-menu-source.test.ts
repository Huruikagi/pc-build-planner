import assert from "node:assert/strict";
import test from "node:test";
import {
  type ChromeContextMenuClickListener,
  type ChromeContextMenusApi,
  createPriceRefreshContextMenuSource,
  priceRefreshContextMenuItemId,
} from "../../../src/features/source-price-refresh/context-menu-source.js";
import { sourcePriceRefreshFeatureId } from "../../../src/features/source-price-refresh/public.js";

const MENU_TITLE = "menu.sourcePriceRefresh.resolved";

interface CreatedMenuItem {
  readonly id?: unknown;
  readonly title?: unknown;
  readonly contexts?: unknown;
  readonly documentUrlPatterns?: unknown;
}

interface ContextMenusStub {
  readonly api: ChromeContextMenusApi;
  readonly readLastError: () => unknown;
  readonly items: Map<string, CreatedMenuItem>;
  readonly listenerCount: () => number;
  readonly duplicateCreateAttempts: () => number;
  readonly uncheckedErrors: () => number;
  readonly createCalls: () => number;
  click(info: unknown, tab?: unknown): void;
}

/**
 * Mirrors the parts of `chrome.contextMenus` this adapter touches, including
 * Chrome's asynchronous-error protocol: a failed `create`/`remove` does not
 * throw, it exposes `runtime.lastError` for the duration of the callback and
 * logs an "unchecked" warning when nobody reads it.
 */
const createContextMenusStub = (
  overrides: {
    readonly failCreate?: boolean;
    readonly failCreateCallback?: boolean;
  } = {},
): ContextMenusStub => {
  const items = new Map<string, CreatedMenuItem>();
  const listeners = new Set<ChromeContextMenuClickListener>();
  let duplicateCreateAttempts = 0;
  let uncheckedErrors = 0;
  let createCalls = 0;
  let pendingError: { readonly message: string } | undefined;
  let consumed = false;

  const settle = (callback?: () => void): void => {
    consumed = false;
    callback?.();
    if (pendingError !== undefined && !consumed) uncheckedErrors += 1;
    pendingError = undefined;
  };

  return {
    api: {
      create(properties, callback) {
        createCalls += 1;
        if (overrides.failCreate === true) throw new Error("create rejected");
        const id = properties.id;
        if (overrides.failCreateCallback === true) {
          setImmediate(() => {
            pendingError = { message: "create rejected" };
            settle(callback);
          });
          return;
        } else if (items.has(id)) {
          duplicateCreateAttempts += 1;
          pendingError = { message: "Cannot create item with duplicate id" };
        } else items.set(id, properties);
        settle(callback);
      },
      remove(menuItemId, callback) {
        if (!items.delete(menuItemId))
          pendingError = { message: "Cannot find menu item" };
        settle(callback);
      },
      onClicked: {
        addListener(listener) {
          listeners.add(listener);
        },
        removeListener(listener) {
          listeners.delete(listener);
        },
      },
    },
    readLastError() {
      consumed = true;
      return pendingError;
    },
    items,
    listenerCount: () => listeners.size,
    duplicateCreateAttempts: () => duplicateCreateAttempts,
    uncheckedErrors: () => uncheckedErrors,
    createCalls: () => createCalls,
    click(info, tab) {
      for (const listener of [...listeners]) listener(info, tab);
    },
  };
};

const validClick = { menuItemId: priceRefreshContextMenuItemId } as const;

test("stable IDとpage context、HTTP/HTTPS document patternでmenu itemを登録する", () => {
  const chrome = createContextMenusStub();
  const source = createPriceRefreshContextMenuSource({
    contextMenus: chrome.api,
    title: MENU_TITLE,
    readLastError: chrome.readLastError,
  });

  assert.equal(source.id, sourcePriceRefreshFeatureId);
  assert.equal(source.surfaceId, sourcePriceRefreshFeatureId);

  const started = source.start(() => undefined);
  assert.equal(started.ok, true);

  const item = chrome.items.get(priceRefreshContextMenuItemId);
  assert.ok(item, "menu item is registered under the stable id");
  assert.equal(item.title, MENU_TITLE);
  assert.deepEqual(item.contexts, ["page"]);
  assert.deepEqual(item.documentUrlPatterns, ["http://*/*", "https://*/*"]);
  assert.equal(chrome.listenerCount(), 1);
  assert.equal(chrome.uncheckedErrors(), 0);
});

test("worker再生成でstartし直してもmenu itemが重複しない", () => {
  const chrome = createContextMenusStub();
  const dependencies = {
    contextMenus: chrome.api,
    title: MENU_TITLE,
    readLastError: chrome.readLastError,
  };

  const first = createPriceRefreshContextMenuSource(dependencies);
  assert.equal(first.start(() => undefined).ok, true);
  // A restarted worker builds a brand new adapter while Chrome still holds the
  // item created by the previous worker generation.
  const second = createPriceRefreshContextMenuSource(dependencies);
  assert.equal(second.start(() => undefined).ok, true);

  assert.equal(chrome.items.size, 1);
  assert.equal(chrome.duplicateCreateAttempts(), 0);
  assert.equal(chrome.uncheckedErrors(), 0);
});

test("既存itemの非同期remove完了後にだけ同じstable IDをcreateする", () => {
  const items = new Set<string>([priceRefreshContextMenuItemId]);
  const pendingRemovals: (() => void)[] = [];
  let duplicateCreateAttempts = 0;
  let createCalls = 0;
  const source = createPriceRefreshContextMenuSource({
    contextMenus: {
      create(properties, callback) {
        createCalls += 1;
        if (items.has(properties.id)) duplicateCreateAttempts += 1;
        else items.add(properties.id);
        callback?.();
      },
      remove(menuItemId, callback) {
        pendingRemovals.push(() => {
          items.delete(menuItemId);
          callback?.();
        });
      },
      onClicked: { addListener() {}, removeListener() {} },
    },
    title: MENU_TITLE,
  });

  assert.equal(source.start(() => undefined).ok, true);
  assert.equal(createCalls, 0, "remove完了前にcreateしない");

  pendingRemovals.shift()?.();

  assert.equal(createCalls, 1);
  assert.equal(duplicateCreateAttempts, 0);
  assert.deepEqual([...items], [priceRefreshContextMenuItemId]);
});

test("deferred callbackを直列化しstale世代の完了順で現行itemを消さない", () => {
  const items = new Set<string>([priceRefreshContextMenuItemId]);
  const removals: (() => void)[] = [];
  const creations: (() => void)[] = [];
  const listeners = new Set<ChromeContextMenuClickListener>();
  const api: ChromeContextMenusApi = {
    create(properties, callback) {
      items.add(properties.id);
      creations.push(() => callback?.());
    },
    remove(menuItemId, callback) {
      removals.push(() => {
        items.delete(menuItemId);
        callback?.();
      });
    },
    onClicked: {
      addListener: (listener) => listeners.add(listener),
      removeListener: (listener) => listeners.delete(listener),
    },
  };
  const first = createPriceRefreshContextMenuSource({
    contextMenus: api,
    title: MENU_TITLE,
  }).start(() => undefined);
  const second = createPriceRefreshContextMenuSource({
    contextMenus: api,
    title: MENU_TITLE,
  }).start(() => undefined);
  assert.equal(first.ok && second.ok, true);
  if (!first.ok || !second.ok) return;

  assert.equal(removals.length, 1, "menu mutationは世代間で直列化する");
  removals.shift()?.();
  assert.equal(removals.length, 1, "stale remove完了後に現行startへ進む");
  removals.shift()?.();
  assert.equal(creations.length, 1);

  first.value();
  creations.shift()?.();
  assert.equal(items.size, 1, "stale cleanupは現行create後のitemを消さない");
  second.value();
  assert.equal(removals.length, 1, "現行cleanupだけがitemをremoveする");
  removals.shift()?.();
  assert.equal(items.size, 0);
});

test("旧世代cleanupは新世代itemを削除せずclickを旧sourceへ戻さない", () => {
  const chrome = createContextMenusStub();
  const firstEmitted: number[] = [];
  const secondEmitted: number[] = [];
  const first = createPriceRefreshContextMenuSource({
    contextMenus: chrome.api,
    title: MENU_TITLE,
    readLastError: chrome.readLastError,
  }).start((tabId) => firstEmitted.push(tabId));
  const second = createPriceRefreshContextMenuSource({
    contextMenus: chrome.api,
    title: MENU_TITLE,
    readLastError: chrome.readLastError,
  }).start((tabId) => secondEmitted.push(tabId));
  assert.equal(first.ok && second.ok, true);
  if (!first.ok || !second.ok) return;

  first.value();
  assert.equal(chrome.items.size, 1, "旧cleanup後も現行itemを保持する");
  chrome.click(validClick, { id: 43 });
  assert.deepEqual(firstEmitted, []);
  assert.deepEqual(secondEmitted, [43]);

  second.value();
  assert.equal(chrome.items.size, 0);
});

test("create callbackのlastError後はlistenerを外してemitしない", async () => {
  const chrome = createContextMenusStub({ failCreateCallback: true });
  const emitted: number[] = [];
  const started = createPriceRefreshContextMenuSource({
    contextMenus: chrome.api,
    title: MENU_TITLE,
    readLastError: chrome.readLastError,
  }).start((tabId) => emitted.push(tabId));

  assert.equal(
    started.ok,
    true,
    "非同期callback failureは同期Resultへ遡及できない",
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(chrome.listenerCount(), 0, "失敗したsourceをfail closedにする");
  chrome.click(validClick, { id: 44 });
  assert.deepEqual(emitted, []);
  assert.equal(chrome.uncheckedErrors(), 0);
});

test("有効なclick一つが固定tabを同期に一度だけemitする", () => {
  const chrome = createContextMenusStub();
  const emitted: number[] = [];
  let insideClick = false;
  let synchronous = true;
  const source = createPriceRefreshContextMenuSource({
    contextMenus: chrome.api,
    title: MENU_TITLE,
    readLastError: chrome.readLastError,
  });
  source.start((tabId) => {
    if (!insideClick) synchronous = false;
    emitted.push(tabId);
  });

  insideClick = true;
  chrome.click(validClick, { id: 42 });
  insideClick = false;

  assert.deepEqual(emitted, [42]);
  assert.equal(synchronous, true);
});

test("別のmenu item IDのclickを無視する", () => {
  const chrome = createContextMenusStub();
  const emitted: number[] = [];
  const source = createPriceRefreshContextMenuSource({
    contextMenus: chrome.api,
    title: MENU_TITLE,
    readLastError: chrome.readLastError,
  });
  source.start((tabId) => emitted.push(tabId));

  chrome.click({ menuItemId: "some-other-feature" }, { id: 42 });
  chrome.click({ menuItemId: 7 }, { id: 42 });
  chrome.click({}, { id: 42 });
  chrome.click(undefined, { id: 42 });

  assert.deepEqual(emitted, []);
});

test("数値でないtab IDや欠損tabのclickを無視する", () => {
  const chrome = createContextMenusStub();
  const emitted: number[] = [];
  const source = createPriceRefreshContextMenuSource({
    contextMenus: chrome.api,
    title: MENU_TITLE,
    readLastError: chrome.readLastError,
  });
  source.start((tabId) => emitted.push(tabId));

  chrome.click(validClick, undefined);
  chrome.click(validClick, {});
  chrome.click(validClick, { id: "42" });
  chrome.click(validClick, { id: -1 });
  chrome.click(validClick, { id: 1.5 });
  chrome.click(validClick, { id: Number.NaN });
  chrome.click(validClick, { id: null });

  assert.deepEqual(emitted, []);
});

test("clickのURL、selection、link、frame情報をemitにもlogにも渡さない", () => {
  const chrome = createContextMenusStub();
  const emitted: unknown[] = [];
  const logged: unknown[] = [];
  const source = createPriceRefreshContextMenuSource({
    contextMenus: chrome.api,
    title: MENU_TITLE,
    readLastError: chrome.readLastError,
  });
  source.start((tabId) => emitted.push(tabId));

  const consoleMethods = [
    "log",
    "info",
    "warn",
    "error",
    "debug",
    "trace",
  ] as const;
  const originals = consoleMethods.map(
    (method) => [method, console[method]] as const,
  );
  for (const [method] of originals)
    console[method] = (...args: unknown[]) => {
      logged.push(...args);
    };
  try {
    chrome.click(
      {
        ...validClick,
        pageUrl: "https://shop.invalid/items/1?token=secret",
        linkUrl: "https://shop.invalid/other",
        selectionText: "12,345円",
        frameId: 3,
        frameUrl: "https://frame.invalid/",
        editable: false,
      },
      { id: 42, url: "https://shop.invalid/items/1", title: "架空ショップ" },
    );
  } finally {
    for (const [method, original] of originals) console[method] = original;
  }

  assert.deepEqual(emitted, [42]);
  assert.deepEqual(logged, []);
});

test("restricted pageはdocument patternで除外し、click payloadのURLでは判定しない", () => {
  // Chrome never shows the item outside the registered HTTP/HTTPS patterns, so
  // the listener deliberately validates the item ID and tab ID only; reading
  // `pageUrl` here would pull a full page URL into worker logic for nothing.
  const chrome = createContextMenusStub();
  const source = createPriceRefreshContextMenuSource({
    contextMenus: chrome.api,
    title: MENU_TITLE,
    readLastError: chrome.readLastError,
  });
  const emitted: number[] = [];
  source.start((tabId) => emitted.push(tabId));

  const item = chrome.items.get(priceRefreshContextMenuItemId);
  assert.ok(item);
  assert.deepEqual(item.documentUrlPatterns, ["http://*/*", "https://*/*"]);

  chrome.click({ ...validClick, pageUrl: "chrome://settings" }, { id: 42 });
  assert.deepEqual(emitted, [42]);
});

test("cleanupでlistenerとmenu itemを対称に解除する", () => {
  const chrome = createContextMenusStub();
  const emitted: number[] = [];
  const source = createPriceRefreshContextMenuSource({
    contextMenus: chrome.api,
    title: MENU_TITLE,
    readLastError: chrome.readLastError,
  });
  const started = source.start((tabId) => emitted.push(tabId));
  assert.equal(started.ok, true);
  if (!started.ok) return;

  started.value();

  assert.equal(chrome.listenerCount(), 0);
  assert.equal(chrome.items.size, 0);
  assert.equal(chrome.uncheckedErrors(), 0);

  chrome.click(validClick, { id: 42 });
  assert.deepEqual(emitted, []);

  // Cleanup is idempotent: a second call must not report a missing item.
  started.value();
  assert.equal(chrome.uncheckedErrors(), 0);
});

test("menu item登録に失敗したらsource-start-failedを返しlistenerを残さない", () => {
  const chrome = createContextMenusStub({ failCreate: true });
  const source = createPriceRefreshContextMenuSource({
    contextMenus: chrome.api,
    title: MENU_TITLE,
    readLastError: chrome.readLastError,
  });

  const started = source.start(() => undefined);
  assert.deepEqual(started, {
    ok: false,
    error: { kind: "source-start-failed" },
  });
  assert.equal(chrome.listenerCount(), 0);
  assert.equal(chrome.createCalls(), 1);
});
