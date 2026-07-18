// @ts-nocheck Web Locksとin-memory doubleの共通排他契約を検証する。
import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import {
  createInMemoryRootWriteLock,
  createInMemoryRootWriteLockState,
} from "../../src/persistence/root-write-lock.ts";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import {
  createWebLocksAdapter,
  ROOT_WRITE_LOCK_NAME,
} from "../../src/persistence/web-locks-adapter.ts";

const createFakeWebLocks = () => {
  const tails = new Map();
  const requests = [];
  return {
    requests,
    async request(name, options, callback) {
      requests.push({ name, mode: options.mode });
      const previous = tails.get(name) ?? Promise.resolve();
      let release;
      const current = new Promise((resolve) => {
        release = resolve;
      });
      tails.set(name, current);
      await previous;
      try {
        return await callback();
      } finally {
        release();
      }
    },
  };
};

const implementations = {
  "in-memory": () => {
    const state = createInMemoryRootWriteLockState();
    return [
      createInMemoryRootWriteLock(state),
      createInMemoryRootWriteLock(state),
    ];
  },
  "Web Locks": () => {
    const api = createFakeWebLocks();
    return [createWebLocksAdapter(api), createWebLocksAdapter(api)];
  },
};

for (const [name, createClients] of Object.entries(implementations)) {
  test(`${name}: 複数clientを順番に実行しcallback失敗後も次へ進む`, async () => {
    const [first, second] = createClients();
    const events = [];
    let releaseFirst;
    const firstMayFinish = new Promise((resolve) => {
      releaseFirst = resolve;
    });

    const firstRequest = first.runExclusive(async () => {
      events.push("first:start");
      await firstMayFinish;
      events.push("first:throw");
      throw new Error("synthetic callback failure");
    });
    const secondRequest = second.runExclusive(async () => {
      events.push("second:start");
      return "completed";
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(events, ["first:start"]);
    releaseFirst();
    await assert.rejects(firstRequest, /synthetic callback failure/);
    assert.deepEqual(await secondRequest, { ok: true, value: "completed" });
    assert.deepEqual(events, ["first:start", "first:throw", "second:start"]);
  });
}

test("Web Locks adapterは全writer共通の固定名をexclusive modeで要求する", async () => {
  const api = createFakeWebLocks();
  const lock = createWebLocksAdapter(api);
  assert.deepEqual(await lock.runExclusive(async () => 42), {
    ok: true,
    value: 42,
  });
  assert.deepEqual(api.requests, [
    { name: ROOT_WRITE_LOCK_NAME, mode: "exclusive" },
  ]);
  assert.equal(ROOT_WRITE_LOCK_NAME, "pc-build-planner:local-data-root-write");
});

test("Web Locks APIの取得失敗をtyped lock-unavailableへ正規化する", async () => {
  const lock = createWebLocksAdapter({
    async request() {
      throw new Error("synthetic platform failure");
    },
  });
  assert.deepEqual(await lock.runExclusive(async () => "unreachable"), {
    ok: false,
    error: { code: "lock-unavailable" },
  });
});
