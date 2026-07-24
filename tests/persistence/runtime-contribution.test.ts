import assert from "node:assert/strict";
import { test } from "node:test";
import type { UtcTimestamp, Uuid } from "../../src/domain/identifiers.js";
import type { MaintenanceOwnerId } from "../../src/domain/model.js";
import type { FoundationError } from "../../src/domain/result.js";
import { initializeFoundationRuntimeContributionFromPlatform as initializeFoundationRuntimeContribution } from "../../src/persistence/runtime-contribution.js";
import { createInitialRoot } from "../../src/persistence/schema.js";

const platform = (options: { restrictFails?: boolean } = {}) => {
  let restrictions = 0;
  let handlers = 0;
  let removedListeners = 0;
  let removedHandlers = 0;
  let storedRoot: unknown = createInitialRoot();
  return {
    counters: {
      get restrictions() {
        return restrictions;
      },
      get handlers() {
        return handlers;
      },
      get removedListeners() {
        return removedListeners;
      },
      get removedHandlers() {
        return removedHandlers;
      },
    },
    value: {
      storageLocal: {
        QUOTA_BYTES: 10 * 1024 * 1024,
        async get() {
          return { localDataRoot: storedRoot };
        },
        async set(items: Record<string, unknown>) {
          if ("localDataRoot" in items) storedRoot = items.localDataRoot;
        },
        async getBytesInUse() {
          return 100;
        },
        async setAccessLevel() {
          restrictions += 1;
          if (options.restrictFails) throw new Error("denied");
        },
      },
      storageChanges: {
        addListener() {},
        removeListener() {
          removedListeners += 1;
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
      now: () => "2026-07-19T00:00:00.000Z" as UtcTimestamp,
      reportError(_error: FoundationError) {},
    },
    target: {
      addHandler() {
        handlers += 1;
        return () => {
          removedHandlers += 1;
        };
      },
    },
  };
};

test("正常platformからaccess制限済みの最小contributionを返す", async () => {
  const fixture = platform();
  const initialized = await initializeFoundationRuntimeContribution(
    fixture.value,
  );
  assert.equal(initialized.ok, true);
  if (!initialized.ok) return;
  assert.deepEqual(Object.keys(initialized.value).sort(), [
    "dataPort",
    "dispose",
    "fullDataPort",
    "maintenanceSource",
    "workerRegistration",
  ]);
  // The scoped port must not carry replacement or maintenance capabilities.
  assert.deepEqual(Object.keys(initialized.value.dataPort).sort(), [
    "mutate",
    "query",
  ]);
  assert.equal(Object.isFrozen(initialized.value.dataPort), true);
  // The full port is the same write authority, exposed for trusted first-party consumers only.
  for (const method of [
    "assessReplacement",
    "mutate",
    "query",
    "replaceRoot",
    "runMaintenance",
  ] as const)
    assert.equal(
      typeof initialized.value.fullDataPort[method],
      "function",
      method,
    );
  assert.equal(fixture.counters.restrictions, 1);
  const registered = await initialized.value.workerRegistration.register(
    fixture.target,
  );
  assert.equal(registered.ok, true);
  assert.equal(fixture.counters.restrictions, 1);
  assert.equal(fixture.counters.handlers, 1);
  const unsubscribe = initialized.value.maintenanceSource.subscribe(
    () => undefined,
  );
  await initialized.value.dispose();
  await initialized.value.dispose();
  assert.equal(fixture.counters.removedListeners, 0);
  assert.equal(fixture.counters.removedHandlers, 0);
  if (registered.ok) registered.value();
  assert.equal(fixture.counters.removedHandlers, 1);
  unsubscribe();
  unsubscribe();
  assert.equal(fixture.counters.removedListeners, 1);
});

test("完全portでの置換は絞り込みportのqueryへ同じrevisionとして反映される", async () => {
  const fixture = platform();
  const initialized = await initializeFoundationRuntimeContribution(
    fixture.value,
  );
  assert.equal(initialized.ok, true);
  if (!initialized.ok) return;

  const before = await initialized.value.dataPort.query(
    (root) => root.revision,
  );
  assert.equal(before.ok, true);

  const ownerId =
    "10000000-0000-4000-8000-000000000001" as Uuid as MaintenanceOwnerId;
  const acquired = await initialized.value.fullDataPort.runMaintenance({
    type: "acquire",
    ownerId,
    leaseMs: 1000,
  });
  assert.equal(acquired.ok, true);
  if (!acquired.ok || acquired.value.fence === undefined) return;
  const fence = acquired.value.fence;

  const candidate = createInitialRoot();
  const assessed =
    await initialized.value.fullDataPort.assessReplacement(candidate);
  assert.equal(assessed.ok, true);
  if (!assessed.ok) return;

  const replaced = await initialized.value.fullDataPort.replaceRoot({
    candidate,
    assessment: assessed.value,
    fence,
  });
  assert.equal(replaced.ok, true);

  await initialized.value.fullDataPort.runMaintenance({
    type: "release",
    fence,
  });

  const after = await initialized.value.dataPort.query((root) => root.revision);
  assert.equal(after.ok, true);
  // acquire (+1) then replaceRoot (+1); release does not persist a candidate change.
  if (before.ok && after.ok) assert.equal(after.value, before.value + 2);

  await initialized.value.dispose();
});

test("不正platformは副作用前にtyped failureとなる", async () => {
  let touched = false;
  const result = await initializeFoundationRuntimeContribution({
    storageLocal: {
      setAccessLevel() {
        touched = true;
      },
    },
  } as never);
  assert.deepEqual(result, { ok: false, error: { code: "invalid-platform" } });
  assert.equal(touched, false);
});

test("初期access restriction失敗時はhandleもhandlerも公開しない", async () => {
  const fixture = platform({ restrictFails: true });
  const result = await initializeFoundationRuntimeContribution(fixture.value);
  assert.deepEqual(result, { ok: false, error: { code: "access-denied" } });
  assert.equal(fixture.counters.restrictions, 1);
  assert.equal(fixture.counters.handlers, 0);
});
