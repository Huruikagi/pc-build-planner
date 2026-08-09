import assert from "node:assert/strict";
import { test } from "node:test";
import type { UtcTimestamp } from "../../src/domain/identifiers.js";
import type { FoundationError } from "../../src/domain/result.js";
import { initializeFoundationRuntimeContributionFromPlatform as initializeFoundationRuntimeContribution } from "../../src/persistence/runtime-contribution.js";
import { createInitialRoot } from "../../src/persistence/schema.js";

const platform = (options: { restrictFails?: boolean } = {}) => {
  let restrictions = 0;
  let handlers = 0;
  let removedListeners = 0;
  let removedHandlers = 0;
  let storedRoot: unknown = createInitialRoot();
  let storedRecoveryControl: unknown;
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
          return {
            localDataRoot: storedRoot,
            ...(storedRecoveryControl === undefined
              ? {}
              : { foundationRecoveryControl: storedRecoveryControl }),
          };
        },
        async set(items: Record<string, unknown>) {
          if ("localDataRoot" in items) storedRoot = items.localDataRoot;
          if ("foundationRecoveryControl" in items)
            storedRecoveryControl = items.foundationRecoveryControl;
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
    "backupRestoreDataPort",
    "dataPort",
    "dispose",
    "maintenanceSource",
    "workerRegistration",
  ]);
  // The scoped port must not carry replacement or maintenance capabilities.
  assert.deepEqual(Object.keys(initialized.value.dataPort).sort(), [
    "mutate",
    "query",
  ]);
  assert.equal(Object.isFrozen(initialized.value.dataPort), true);
  assert.deepEqual(
    Object.keys(initialized.value.backupRestoreDataPort).sort(),
    [
      "assessRecovery",
      "assessReplacement",
      "commit",
      "finalize",
      "findPendingFinalization",
    ],
  );
  assert.equal("query" in initialized.value.backupRestoreDataPort, false);
  assert.equal("mutate" in initialized.value.backupRestoreDataPort, false);
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

test("backup専用portでの置換は絞り込みportのqueryへ同じrevisionとして反映される", async () => {
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

  const candidate = createInitialRoot();
  const assessed =
    await initialized.value.backupRestoreDataPort.assessReplacement(candidate);
  assert.equal(assessed.ok, true);
  if (!assessed.ok) return;

  const replaced = await initialized.value.backupRestoreDataPort.commit({
    candidate,
    assessment: assessed.value.ticket,
    expectedMode: "normal",
  });
  assert.equal(replaced.ok, true, JSON.stringify(replaced));

  const after = await initialized.value.dataPort.query((root) => root.revision);
  assert.equal(after.ok, true);
  if (before.ok && after.ok) assert.equal(after.value, before.value + 1);

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
