import assert from "node:assert/strict";
import { test } from "node:test";
import type { UtcTimestamp } from "../../src/domain/identifiers.js";
import type { FoundationError } from "../../src/domain/result.js";
import { initializeFoundationRuntimeContribution } from "../../src/persistence/public.js";
import { createInitialRoot } from "../../src/persistence/schema.js";
import type { WorkerMessageHandler } from "../../src/persistence/worker-registration.js";

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const NOW = "2026-07-19T00:00:00.000Z" as UtcTimestamp;

const createPlatformHarness = () => {
  let stored = createInitialRoot();
  const listeners = new Set<
    (changes: Readonly<Record<string, unknown>>, areaName: string) => void
  >();
  let restrictions = 0;
  const platform = {
    storageLocal: {
      QUOTA_BYTES: 10 * 1024 * 1024,
      async get(key: string) {
        return { [key]: structuredClone(stored) };
      },
      async set(items: Record<string, unknown>) {
        stored = structuredClone(items.localDataRoot) as typeof stored;
        for (const listener of listeners)
          listener({ localDataRoot: { newValue: stored } }, "local");
      },
      async getBytesInUse() {
        return JSON.stringify(stored).length;
      },
      async setAccessLevel() {
        restrictions += 1;
      },
    },
    storageChanges: {
      addListener(
        listener: (
          changes: Readonly<Record<string, unknown>>,
          areaName: string,
        ) => void,
      ) {
        listeners.add(listener);
      },
      removeListener(
        listener: (
          changes: Readonly<Record<string, unknown>>,
          areaName: string,
        ) => void,
      ) {
        listeners.delete(listener);
      },
    },
    locks: {
      async request<T>(
        _name: string,
        _options: { readonly mode: "exclusive" },
        callback: () => Promise<T>,
      ) {
        return callback();
      },
    },
    authorize: () => true,
    now: () => NOW,
    reportError(_error: FoundationError) {},
  };
  return {
    platform,
    restrictions: () => restrictions,
    listenerCount: () => listeners.size,
  };
};

const createTarget = () => {
  const handlers = new Set<WorkerMessageHandler>();
  return {
    target: {
      addHandler(handler: WorkerMessageHandler) {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
    },
    handler: () => {
      assert.equal(handlers.size, 1);
      return [...handlers][0] as WorkerMessageHandler;
    },
    handlerCount: () => handlers.size,
  };
};

test("再生成したproduction graphは同じ永続rootのmaintenance fenceとrevisionを観測する", async () => {
  const harness = createPlatformHarness();
  const first = await initializeFoundationRuntimeContribution(harness.platform);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const firstTarget = createTarget();
  const firstRegistration = await first.value.workerRegistration.register(
    firstTarget.target,
  );
  assert.equal(firstRegistration.ok, true);
  if (!firstRegistration.ok) return;

  const observed: unknown[] = [];
  const unsubscribe = first.value.maintenanceSource.subscribe((snapshot) =>
    observed.push(snapshot),
  );
  const acquired = await firstTarget.handler()(
    {
      kind: "run-maintenance",
      command: { type: "acquire", ownerId: OWNER_A, leaseMs: 60_000 },
    },
    { kind: "trusted-extension" },
  );
  assert.equal(acquired.ok, true);
  assert.equal(acquired.ok && "fence" in acquired.value, true);
  if (!acquired.ok || !("fence" in acquired.value)) return;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await first.value.maintenanceSource.getSnapshot(), {
    ok: true,
    value: { generation: 1, revision: 1, active: true },
  });
  assert.deepEqual(observed, [{ generation: 1, revision: 1, active: true }]);

  const recreated = await initializeFoundationRuntimeContribution(
    harness.platform,
  );
  assert.equal(recreated.ok, true);
  if (!recreated.ok) return;
  const secondTarget = createTarget();
  const secondRegistration = await recreated.value.workerRegistration.register(
    secondTarget.target,
  );
  assert.equal(secondRegistration.ok, true);
  if (!secondRegistration.ok) return;
  assert.deepEqual(await recreated.value.maintenanceSource.getSnapshot(), {
    ok: true,
    value: { generation: 1, revision: 1, active: true },
  });
  const ownerlessRejected = await secondTarget.handler()(
    {
      kind: "mutate-root",
      command: {
        requestId: REQUEST_ID,
        expectedRevision: 1,
        operation: { kind: "delete", entity: "project", id: OWNER_B },
      },
    },
    { kind: "trusted-extension" },
  );
  assert.deepEqual(ownerlessRejected, {
    ok: false,
    error: { code: "maintenance-active" },
  });
  const otherOwnerRejected = await secondTarget.handler()(
    {
      kind: "mutate-root",
      command: {
        requestId: "44444444-4444-4444-8444-444444444444",
        expectedRevision: 1,
        maintenance: { ...acquired.value.fence, ownerId: OWNER_B },
        operation: { kind: "delete", entity: "project", id: OWNER_B },
      },
    },
    { kind: "trusted-extension" },
  );
  assert.deepEqual(otherOwnerRejected, {
    ok: false,
    error: { code: "stale-fence" },
  });
  assert.deepEqual(await first.value.maintenanceSource.getSnapshot(), {
    ok: true,
    value: { generation: 1, revision: 1, active: true },
  });

  firstRegistration.value();
  assert.equal(firstTarget.handlerCount(), 0);
  assert.equal(secondTarget.handlerCount(), 1);
  unsubscribe();
  unsubscribe();
  assert.equal(harness.listenerCount(), 0);
  secondRegistration.value();
  assert.equal(secondTarget.handlerCount(), 0);
  await first.value.dispose();
  await first.value.dispose();
  await recreated.value.dispose();
  await recreated.value.dispose();
  assert.equal(harness.restrictions(), 2);
});
