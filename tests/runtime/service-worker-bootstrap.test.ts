import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type {
  ApplicationWorkerRegistration,
  FeatureId,
} from "../../src/application-shell/contracts.js";
import { createCatalogWorkerBootstrap } from "../../src/runtime/service-worker.js";

test("catalogからworker contributionだけを選択して一度だけ合成する", async () => {
  const events: string[] = [];
  const worker: ApplicationWorkerRegistration = {
    id: "worker" as FeatureId,
    register() {
      events.push("worker:start");
      return { ok: true, value: () => events.push("worker:stop") };
    },
  };
  const catalog = [
    {
      key: "ui",
      registration: {
        id: "ui" as FeatureId,
        navigation: { label: "UI", order: 1 },
        publicApi: { value: true },
        getAvailability: () => ({ status: "available" }) as const,
        subscribeAvailability: () => () => {},
        async mount() {
          return { async unmount() {} };
        },
      },
      workerRegistration: worker,
    },
  ] as const;
  const bootstrap = createCatalogWorkerBootstrap(catalog, {
    addActionHandler: () => () => {},
    reportError() {},
  });

  assert.equal((await bootstrap.start()).ok, true);
  assert.equal((await bootstrap.start()).ok, true);
  await bootstrap.stop();
  await bootstrap.stop();
  assert.deepEqual(events, ["worker:start", "worker:stop"]);
});

test("service worker入口にlegacy composition root bootstrapを残さない", async () => {
  const source = await readFile("src/runtime/service-worker.ts", "utf8");
  assert.doesNotMatch(source, /createServiceWorkerBootstrap/);
  assert.doesNotMatch(source, /ApplicationCompositionRoot|CompositionError/);
});
