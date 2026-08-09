import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { FeatureId } from "../../src/application-shell/contracts.js";
import type { FeatureContribution } from "../../src/application-shell/feature-contribution-catalog.js";
import type { FoundationRuntimeContribution } from "../../src/persistence/public.js";
import type { RuntimeMessageListener } from "../../src/runtime/foundation-message-target.js";
import {
  createProductionServiceWorkerBootstrap,
  registerProductionTransientWatchReady,
} from "../../src/runtime/service-worker.js";
import type { MessageKey } from "../../src/ui-messages/public.js";

test("runtime bootstrapはfoundationの具体initializerを直接importしない", async () => {
  const source = await readFile("src/runtime/service-worker.ts", "utf8");

  assert.doesNotMatch(source, /from\s+["']\.\.\/persistence\/public\.js["']/);
  assert.doesNotMatch(
    source,
    /initializeProductionFoundationRuntimeContribution/,
  );
});

test("production moduleはworker-safe catalogからtransient surface IDを解決する", async () => {
  const source = await readFile("src/runtime/service-worker.ts", "utf8");
  const catalog = await readFile(
    "src/application-shell/feature-contribution-catalog.ts",
    "utf8",
  );

  assert.doesNotMatch(source, /features\/product-capture/);
  assert.match(source, /catalog\.find\([\s\S]*?transientSurfaceId/);
  assert.match(catalog, /productCaptureWorkerContribution/);
});

test("watch-ready bootstrapはruntimeとsessionの実Chrome階層を同期接続する", () => {
  const listeners: RuntimeMessageListener[] = [];
  const runtime = {
    id: "extension-id",
    getURL: (path: string) => `chrome-extension://extension-id/${path}`,
    onMessage: {
      addListener(listener: RuntimeMessageListener) {
        listeners.push(listener);
      },
      removeListener(listener: RuntimeMessageListener) {
        listeners.splice(listeners.indexOf(listener), 1);
      },
    },
  };
  const session = {
    async get() {
      return {};
    },
    async set() {},
  };

  const cleanup = registerProductionTransientWatchReady(runtime, session);
  assert.equal(listeners.length, 1);
  cleanup();
  assert.equal(listeners.length, 0);
});

test("production bootstrapでfoundation handlerとcatalog actionを順序どおり共存させ逆順cleanupする", async () => {
  const events: string[] = [];
  const listeners: RuntimeMessageListener[] = [];
  const runtime = {
    id: "extension-id",
    getURL: (path: string) => `chrome-extension://extension-id/${path}`,
    onMessage: {
      addListener(listener: RuntimeMessageListener) {
        listeners.push(listener);
        events.push(`listener:add:${listeners.length}`);
      },
      removeListener(listener: RuntimeMessageListener) {
        events.push(`listener:remove:${listeners.indexOf(listener) + 1}`);
        listeners.splice(listeners.indexOf(listener), 1);
      },
    },
  };
  const foundation: FoundationRuntimeContribution = {
    maintenanceSource: {
      getSnapshot: async () => ({ ok: true, value: {} as never }),
      subscribe: () => () => {},
    },
    dataPort: {
      query: async () => ({ ok: true, value: {} as never }),
      mutate: async () => ({ ok: true, value: {} as never }),
    },
    backupRestoreDataPort: {
      assessReplacement: async () => ({ ok: true, value: {} as never }),
      assessRecovery: async () => ({ ok: true, value: {} as never }),
      commit: async () => ({ ok: true, value: {} as never }),
      findPendingFinalization: async () => ({ ok: true, value: null }),
      finalize: async () => ({ ok: true, value: {} as never }),
    },
    workerRegistration: {
      async register(target) {
        events.push("foundation:register");
        return {
          ok: true,
          value: target.addHandler(async () => ({
            ok: true,
            value: {} as never,
          })),
        };
      },
    },
    dispose() {
      events.push("foundation:dispose");
    },
  };
  const catalog: readonly FeatureContribution[] = [
    {
      key: "feature",
      registration: {
        id: "feature" as FeatureId,
        presentation: "persistent",
        navigation: { labelKey: "Feature" as MessageKey, order: 1 },
        publicApi: {},
        getAvailability: () => ({ status: "available" }),
        subscribeAvailability: () => () => {},
        async mount() {
          return { async unmount() {} };
        },
      },
      workerRegistration: {
        id: "feature" as FeatureId,
        register(context) {
          events.push("catalog:register");
          return {
            ok: true,
            value: context.addActionHandler(
              "feature" as FeatureId,
              async () => {
                events.push("catalog:action");
              },
            ),
          };
        },
      },
    },
  ];
  const bootstrap = createProductionServiceWorkerBootstrap(
    runtime,
    catalog,
    async () => {
      events.push("foundation:init");
      return { ok: true, value: foundation };
    },
  );

  assert.equal((await bootstrap.start()).ok, true);
  assert.deepEqual(events.slice(0, 5), [
    "foundation:init",
    "foundation:register",
    "listener:add:1",
    "catalog:register",
    "listener:add:2",
  ]);

  const foundationResponses: unknown[] = [];
  const actionResponses: unknown[] = [];
  for (const listener of [...listeners])
    listener(
      { kind: "query-root" },
      { id: runtime.id, url: runtime.getURL("") },
      (value) => foundationResponses.push(value),
    );
  await Promise.resolve();
  assert.equal(foundationResponses.length, 1);
  assert.doesNotMatch(events.join("\n"), /catalog:action/);
  for (const listener of [...listeners])
    listener({ actionId: "feature" }, {}, (value) =>
      actionResponses.push(value),
    );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(actionResponses, [{ ok: true }]);
  assert.equal(events.filter((event) => event === "catalog:action").length, 1);

  await bootstrap.stop();
  assert.deepEqual(events.slice(-3), [
    "listener:remove:2",
    "listener:remove:1",
    "foundation:dispose",
  ]);
  assert.equal(listeners.length, 0);
});
