import assert from "node:assert/strict";
import test from "node:test";
import { featureContributionCatalog } from "../../src/application-shell/feature-contribution-catalog.js";
import type { TransientMenuGestureDependencies } from "../../src/application-shell/transient-surface-ports.js";
import { createProductionTransientRuntimeBootstrap } from "../../src/runtime/service-worker.js";

const MENU_TITLE = "menu.sourcePriceRefresh.resolved";
const MENU_ITEM_ID = "source-price-refresh";

type Listener<T extends unknown[]> = (...args: T) => void;

const event = <T extends unknown[]>() => {
  const listeners = new Set<Listener<T>>();
  return {
    addListener(listener: Listener<T>) {
      listeners.add(listener);
    },
    removeListener(listener: Listener<T>) {
      listeners.delete(listener);
    },
    emit(...args: T) {
      for (const listener of [...listeners]) listener(...args);
    },
    size: () => listeners.size,
  };
};

type MenuClickListener = (info: unknown, tab?: unknown) => void;

/**
 * Mirrors the slice of `chrome.contextMenus` the worker composition touches,
 * including Chrome's asynchronous-error protocol: a failed `create`/`remove`
 * exposes `runtime.lastError` for the duration of the callback instead of
 * throwing, and warns when nobody reads it.
 */
const createContextMenusStub = () => {
  const items = new Map<string, { readonly title?: unknown }>();
  const listeners = new Set<MenuClickListener>();
  let duplicateCreateAttempts = 0;
  let uncheckedErrors = 0;
  let removeCalls = 0;
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
      create(
        properties: { readonly id: string; readonly title: string },
        callback?: () => void,
      ) {
        if (items.has(properties.id)) {
          duplicateCreateAttempts += 1;
          pendingError = { message: "Cannot create item with duplicate id" };
        } else items.set(properties.id, properties);
        settle(callback);
      },
      remove(menuItemId: string, callback?: () => void) {
        removeCalls += 1;
        if (!items.delete(menuItemId))
          pendingError = { message: "Cannot find menu item" };
        settle(callback);
      },
      onClicked: {
        addListener(listener: MenuClickListener) {
          listeners.add(listener);
        },
        removeListener(listener: MenuClickListener) {
          listeners.delete(listener);
        },
      },
    },
    readLastError: () => {
      consumed = true;
      return pendingError;
    },
    items,
    listenerCount: () => listeners.size,
    duplicateCreateAttempts: () => duplicateCreateAttempts,
    uncheckedErrors: () => uncheckedErrors,
    removeCalls: () => removeCalls,
    click(info: unknown, tab?: unknown) {
      for (const listener of [...listeners]) listener(info, tab);
    },
  };
};

const settleTasks = () => new Promise((resolve) => setImmediate(resolve));

const createHarness = () => {
  const action = event<[{ id?: number }]>();
  const onUpdated = event<[number, { status?: string }]>();
  const onRemoved = event<[number]>();
  const messages = event<[unknown, unknown, (response: unknown) => void]>();
  const opened: number[] = [];
  let stored: unknown;
  const runtime = {
    id: "extension-id",
    getURL: (path: string) => `chrome-extension://extension-id/${path}`,
    getManifest: () => ({ name: "Planner", action: {} }),
    onMessage: messages,
  };
  const chromeApis = {
    storage: {
      session: {
        async get() {
          return { transientActivationEnvelope: stored };
        },
        async set(items: { readonly transientActivationEnvelope: unknown }) {
          stored = items.transientActivationEnvelope;
        },
      },
    },
    action: {
      onClicked: action,
      async setBadgeText() {},
      async setTitle() {},
    },
    tabs: { onUpdated, onRemoved },
    sidePanel: {
      async open({ tabId }: { readonly tabId?: number }) {
        if (tabId !== undefined) opened.push(tabId);
      },
    },
  };
  return {
    action,
    onUpdated,
    onRemoved,
    messages,
    opened,
    runtime,
    chromeApis,
  };
};

const menuDependencies = (
  menus: ReturnType<typeof createContextMenusStub>,
): TransientMenuGestureDependencies => ({
  contextMenus: menus.api,
  title: MENU_TITLE,
  readLastError: menus.readLastError,
});

test("worker-safe catalogはsource-price-refreshのmenu registrationだけを載せる", () => {
  const entries = featureContributionCatalog.filter(
    (entry) =>
      (entry as { readonly createMenuGestureSource?: unknown })
        .createMenuGestureSource !== undefined,
  );

  assert.equal(
    entries.length,
    1,
    "menu gesture contributionはちょうど1件である",
  );
  const entry = entries[0] as {
    readonly createMenuGestureSource?: unknown;
    readonly registration?: unknown;
    readonly workerRegistration?: unknown;
    readonly transientSurfaceId?: unknown;
  };
  assert.equal(typeof entry.createMenuGestureSource, "function");
  assert.equal(entry.registration, undefined, "UI registrationを持ち込まない");
  assert.equal(entry.workerRegistration, undefined);
  assert.equal(
    entry.transientSurfaceId,
    undefined,
    "拡張アイコン起動のcanonical surfaceにはならない",
  );
});

test("context menu clickは既存経路へ正しいsurfaceIdとtabIdのactivationを一度だけ作る", async () => {
  const harness = createHarness();
  const menus = createContextMenusStub();

  const composition = createProductionTransientRuntimeBootstrap(
    harness.runtime,
    harness.chromeApis,
    featureContributionCatalog,
    menuDependencies(menus),
  );

  const item = menus.items.get(MENU_ITEM_ID);
  assert.ok(item, "stable IDでmenu itemを登録する");
  assert.equal(item.title, MENU_TITLE);
  assert.equal(menus.uncheckedErrors(), 0);

  menus.click({ menuItemId: MENU_ITEM_ID }, { id: 77 });
  await settleTasks();

  const record = await composition.scheduler.store.read();
  assert.equal(record.ok && record.value?.surfaceId, "source-price-refresh");
  assert.equal(record.ok && record.value?.tabId, 77);
  assert.deepEqual(harness.opened, [77], "side panelは一度だけ開く");

  const activationId = record.ok ? record.value?.activationId : undefined;
  const response = await new Promise<unknown>((resolve) => {
    harness.messages.emit(
      { version: 1, kind: "transient-watch-ready", activationId },
      {
        id: harness.runtime.id,
        url: harness.runtime.getURL("side-panel.html"),
      },
      resolve,
    );
  });
  assert.equal(
    (response as { decision?: { kind?: string } }).decision?.kind,
    "authorized",
    "既存のwatch-ready経路がそのまま認可する",
  );

  harness.onRemoved.emit(77);
  await settleTasks();
  const envelope = await composition.scheduler.store.readEnvelope();
  assert.deepEqual(
    envelope.ok && envelope.value.tombstones.map((entry) => entry.tabId),
    [77],
    "同じschedulerがtab墓標を記録する",
  );

  await composition.cleanup();
});

test("production bootstrapはChrome menu APIとcatalog由来menu labelを自動注入する", async () => {
  const harness = createHarness();
  const menus = createContextMenusStub();
  const composition = createProductionTransientRuntimeBootstrap(
    harness.runtime,
    {
      ...harness.chromeApis,
      contextMenus: menus.api,
      readLastError: menus.readLastError,
      i18n: { getUILanguage: () => "ja-JP" },
    },
    featureContributionCatalog,
  );

  const item = menus.items.get(MENU_ITEM_ID);
  assert.ok(item, "production依存からmenu itemを登録する");
  assert.equal(item.title, "価格を更新", "ja catalogのmenuLabelを解決する");
  await composition.cleanup();
});

test("worker停止でmenu listenerとgesture登録を対称に解除する", async () => {
  const harness = createHarness();
  const menus = createContextMenusStub();
  // Teardown order is observed at the two Chrome seams the composition owns:
  // gesture sources must stop producing activations before the watch-ready
  // listener and the scheduler behind it are dismantled.
  const order: string[] = [];
  const runtime = {
    ...harness.runtime,
    onMessage: {
      addListener: harness.messages.addListener,
      removeListener(listener: Parameters<typeof harness.messages.emit>[0]) {
        order.push("watch-ready");
        harness.messages.removeListener(
          listener as unknown as Parameters<
            typeof harness.messages.removeListener
          >[0],
        );
      },
    },
  };
  const composition = createProductionTransientRuntimeBootstrap(
    runtime,
    harness.chromeApis,
    featureContributionCatalog,
    {
      ...menuDependencies(menus),
      contextMenus: {
        ...menus.api,
        remove(menuItemId: string, callback?: () => void) {
          order.push("menu");
          menus.api.remove(menuItemId, callback);
        },
      },
    },
  );
  assert.equal(menus.listenerCount(), 1);
  order.length = 0;

  await composition.cleanup();

  assert.deepEqual(
    order,
    ["menu", "watch-ready"],
    "gesture登録をwatch-readyとschedulerより先に解除する",
  );
  assert.equal(menus.listenerCount(), 0, "click listenerを解除する");
  assert.equal(menus.items.size, 0, "menu itemを解除する");
  assert.equal(menus.uncheckedErrors(), 0);
  assert.equal(harness.action.size(), 0);
  assert.equal(harness.onUpdated.size(), 0);
  assert.equal(harness.onRemoved.size(), 0);
  assert.equal(harness.messages.size(), 0);

  menus.click({ menuItemId: MENU_ITEM_ID }, { id: 78 });
  await settleTasks();
  assert.deepEqual(harness.opened, [], "停止後のclickは何も起動しない");
});

test("worker再生成後もmenu itemは重複せずclickが一度だけ流れる", async () => {
  const menus = createContextMenusStub();
  const first = createHarness();
  const firstComposition = createProductionTransientRuntimeBootstrap(
    first.runtime,
    first.chromeApis,
    featureContributionCatalog,
    menuDependencies(menus),
  );
  // Chrome keeps the item across a worker restart, so the next generation must
  // re-register the same stable ID without leaving a duplicate behind.
  const second = createHarness();
  const secondComposition = createProductionTransientRuntimeBootstrap(
    second.runtime,
    second.chromeApis,
    featureContributionCatalog,
    menuDependencies(menus),
  );

  assert.equal(menus.items.size, 1);
  assert.equal(menus.duplicateCreateAttempts(), 0);
  assert.equal(menus.uncheckedErrors(), 0);

  await firstComposition.cleanup();
  assert.equal(menus.items.size, 1, "旧世代cleanupは現行itemを削除しない");
  menus.click({ menuItemId: MENU_ITEM_ID }, { id: 79 });
  await settleTasks();
  assert.deepEqual(first.opened, [], "旧世代listenerは停止済みである");
  assert.deepEqual(second.opened, [79], "現行世代だけが一度起動する");
  const removeCallsAfterFirstStop = menus.removeCalls();
  // The stale generation's teardown must not delete the live item.
  await firstComposition.cleanup();
  assert.equal(menus.removeCalls(), removeCallsAfterFirstStop);

  await secondComposition.cleanup();
  assert.equal(menus.listenerCount(), 0);
  assert.equal(menus.items.size, 0);
});
