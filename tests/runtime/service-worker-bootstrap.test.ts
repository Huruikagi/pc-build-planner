import assert from "node:assert/strict";
import test from "node:test";
import type { FeatureId } from "../../src/application-shell/contracts.js";
import type { FeatureContribution } from "../../src/application-shell/feature-contribution-catalog.js";
import type { FoundationRuntimeContribution } from "../../src/persistence/public.js";
import type { RuntimeMessageListener } from "../../src/runtime/foundation-message-target.js";
import { createProductionServiceWorkerBootstrap } from "../../src/runtime/service-worker.js";

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
        navigation: { label: "Feature", order: 1 },
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
