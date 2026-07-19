// @ts-nocheck error経路と変更event payloadを意図的に単純stubで検証する。
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(
      specifier.endsWith("/schema.js")
        ? `${specifier.slice(0, -3)}.ts`
        : specifier,
      context,
    );
  },
});

// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
const { createMaintenanceSnapshotSource } = await import(
  "../../src/persistence/maintenance-snapshot-source.ts"
);

const root = (revision, generation, active) => ({
  schemaVersion: 1,
  revision,
  projects: [],
  candidateParts: [],
  currentBuilds: [],
  requestDedupe: [],
  maintenance: active
    ? {
        generation,
        active: true,
        ownerId: "00000000-0000-4000-8000-000000000001",
        leaseExpiresAt: "2030-01-01T00:00:01.000Z",
      }
    : { generation, active: false },
});

const createChangeEvent = () => {
  const listeners = new Set();
  return {
    addCalls: 0,
    removeCalls: 0,
    addListener(listener) {
      this.addCalls += 1;
      listeners.add(listener);
    },
    removeListener(listener) {
      this.removeCalls += 1;
      listeners.delete(listener);
    },
    emit(changes, areaName = "local") {
      for (const listener of listeners) listener(changes, areaName);
    },
  };
};

const flushAsyncNotification = () =>
  new Promise((resolve) => setImmediate(resolve));

test("検証済みrootからgeneration revision activeだけをsnapshot化する", async () => {
  const repository = {
    async readRoot() {
      return { ok: true, value: root(7, 3, true) };
    },
  };
  const source = createMaintenanceSnapshotSource({
    repository,
    changes: createChangeEvent(),
    reportError: () => undefined,
  });

  assert.deepEqual(await source.getSnapshot(), {
    ok: true,
    value: { generation: 3, revision: 7, active: true },
  });
});

test("localDataRoot変更時だけRepositoryを再読込して通知する", async () => {
  let current = root(0, 0, false);
  let reads = 0;
  const repository = {
    async readRoot() {
      reads += 1;
      return { ok: true, value: current };
    },
  };
  const changes = createChangeEvent();
  const source = createMaintenanceSnapshotSource({
    repository,
    changes,
    reportError: () => undefined,
  });
  const received = [];
  source.subscribe((snapshot) => received.push(snapshot));

  changes.emit({ unrelated: { newValue: "ignored" } });
  changes.emit({ localDataRoot: { newValue: "untrusted" } }, "sync");
  current = root(2, 1, true);
  changes.emit({ localDataRoot: { newValue: "not-used" } });
  await flushAsyncNotification();

  assert.equal(reads, 1);
  assert.deepEqual(received, [{ generation: 1, revision: 2, active: true }]);
});

test("読取失敗を正常通知せずtyped diagnosticへ渡す", async () => {
  const error = { code: "corrupt-data" };
  const repository = {
    async readRoot() {
      return { ok: false, error };
    },
  };
  const changes = createChangeEvent();
  const diagnostics = [];
  const received = [];
  const source = createMaintenanceSnapshotSource({
    repository,
    changes,
    reportError: (next) => diagnostics.push(next),
  });
  source.subscribe((snapshot) => received.push(snapshot));

  changes.emit({ localDataRoot: { newValue: {} } });
  await flushAsyncNotification();

  assert.deepEqual(received, []);
  assert.deepEqual(diagnostics, [error]);
});

test("購読解除は冪等で解除後の変更を配信しない", async () => {
  const repository = {
    async readRoot() {
      return { ok: true, value: root(1, 1, false) };
    },
  };
  const changes = createChangeEvent();
  const source = createMaintenanceSnapshotSource({
    repository,
    changes,
    reportError: () => undefined,
  });
  const received = [];
  const unsubscribe = source.subscribe((snapshot) => received.push(snapshot));

  unsubscribe();
  unsubscribe();
  changes.emit({ localDataRoot: { newValue: {} } });
  await flushAsyncNotification();

  assert.equal(changes.addCalls, 1);
  assert.equal(changes.removeCalls, 1);
  assert.deepEqual(received, []);
});
