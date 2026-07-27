import assert from "node:assert/strict";
import test from "node:test";
import type { FeatureId } from "../../src/application-shell/contracts.js";
import type {
  ActivationId,
  TargetTabId,
} from "../../src/application-shell/transient-surface-ports.js";
import {
  type ActivationSequence,
  createTransientActivationScheduler,
  createTransientActivationStore,
  MAX_TRANSIENT_TOMBSTONES,
  type TransientActivationEnvelope,
  type TransientSessionStorage,
} from "../../src/runtime/transient-activation-store.js";

const featureId = "capture" as FeatureId;
const activationId = (value: string) => value as ActivationId;
const tabId = (value: number) => value as TargetTabId;
const seq = (value: number) => value as ActivationSequence;

class MemorySession implements TransientSessionStorage {
  value: unknown;
  writes: unknown[] = [];
  async get(): Promise<unknown> {
    return this.value;
  }
  async set(value: TransientActivationEnvelope): Promise<void> {
    this.value = structuredClone(value);
    this.writes.push(this.value);
  }
}

class DeferredFirstWriteSession extends MemorySession {
  #release!: () => void;
  #markStarted!: () => void;
  readonly firstWriteStarted = new Promise<void>((resolve) => {
    this.#markStarted = resolve;
  });
  readonly #gate = new Promise<void>((resolve) => {
    this.#release = resolve;
  });
  override async set(value: TransientActivationEnvelope): Promise<void> {
    if (this.writes.length === 0) {
      this.#markStarted();
      await this.#gate;
    }
    await super.set(value);
  }
  release(): void {
    this.#release();
  }
}

test("破損envelopeと不正stage遷移をtyped errorにする", async () => {
  const session = new MemorySession();
  session.value = { version: 2, lastSequence: 0, tombstones: [] };
  const store = createTransientActivationStore(session);
  assert.deepEqual(await store.read(), {
    ok: false,
    error: { kind: "unsupported-version" },
  });

  session.value = {
    version: 1,
    lastSequence: 1,
    tombstones: [],
    record: {
      activationId: "a",
      surfaceId: "capture",
      tabId: 1,
      seq: 1,
      stage: "activated",
    },
  };
  assert.deepEqual(await store.requestAdvance(activationId("a"), "received"), {
    ok: false,
    error: { kind: "invalid-stage-transition" },
  });
});

test("schedulerは保留writeを追い越さず再生成後もsequenceを増加する", async () => {
  const session = new MemorySession();
  const scheduler = createTransientActivationScheduler(
    createTransientActivationStore(session),
  );
  const first = scheduler.put({
    activationId: activationId("a"),
    surfaceId: featureId,
    tabId: tabId(1),
  });
  const second = scheduler.put({
    activationId: activationId("b"),
    surfaceId: featureId,
    tabId: tabId(2),
  });
  assert.equal((await first).ok, true);
  assert.equal((await second).ok, true);
  assert.deepEqual(
    session.writes.map(
      (value) => (value as TransientActivationEnvelope).lastSequence,
    ),
    [1, 2],
  );

  const recreated = createTransientActivationScheduler(
    createTransientActivationStore(session),
  );
  assert.equal(
    (
      await recreated.put({
        activationId: activationId("c"),
        surfaceId: featureId,
        tabId: tabId(3),
      })
    ).ok,
    true,
  );
  assert.equal((session.value as TransientActivationEnvelope).lastSequence, 3);
});

test("scheduler closeは保留commandをdrainし停止後のenqueueを拒否する", async () => {
  const session = new DeferredFirstWriteSession();
  const scheduler = createTransientActivationScheduler(
    createTransientActivationStore(session),
  );
  const pending = scheduler.put({
    activationId: activationId("pending"),
    surfaceId: featureId,
    tabId: tabId(1),
  });
  await session.firstWriteStarted;

  const closing = scheduler.close();
  await assert.rejects(
    scheduler.put({
      activationId: activationId("late"),
      surfaceId: featureId,
      tabId: tabId(2),
    }),
    { name: "TransientActivationSchedulerClosedError" },
  );
  session.release();
  assert.equal((await pending).ok, true);
  await closing;
  assert.equal(session.writes.length, 1);
});

test("worker再生成時はrecordと墓標を含むenvelope最大sequenceから復元する", async () => {
  const session = new MemorySession();
  session.value = {
    version: 1,
    lastSequence: 1,
    record: {
      activationId: "previous",
      surfaceId: "capture",
      tabId: 1,
      seq: 10,
      stage: "activated",
    },
    tombstones: [{ tabId: 2, seq: 12 }],
  };
  const scheduler = createTransientActivationScheduler(
    createTransientActivationStore(session),
  );
  assert.equal(
    (
      await scheduler.put({
        activationId: activationId("next"),
        surfaceId: featureId,
        tabId: tabId(3),
      })
    ).ok,
    true,
  );
  assert.equal(
    (session.value as TransientActivationEnvelope).record?.seq,
    seq(13),
  );
});

test("初期sequence base読出し失敗後も同じworker内の再操作で復旧する", async () => {
  const session = new MemorySession();
  let failReads = true;
  const scheduler = createTransientActivationScheduler(
    createTransientActivationStore({
      async get() {
        if (failReads) throw new Error("unavailable");
        return session.get();
      },
      set: (value) => session.set(value),
    }),
  );
  assert.deepEqual(
    await scheduler.put({
      activationId: activationId("first"),
      surfaceId: featureId,
      tabId: tabId(1),
    }),
    { ok: false, error: { kind: "storage-unavailable" } },
  );
  failReads = false;
  assert.equal(
    (
      await scheduler.put({
        activationId: activationId("retry"),
        surfaceId: featureId,
        tabId: tabId(1),
      })
    ).ok,
    true,
  );
});

test("late putを墓標でinvalidatedにし同一tabの新世代は許可する", async () => {
  const session = new MemorySession();
  const scheduler = createTransientActivationScheduler(
    createTransientActivationStore(session),
  );
  assert.equal((await scheduler.invalidate(tabId(7))).ok, true);
  assert.equal(
    (
      await scheduler.putAtSequence(
        {
          activationId: activationId("old"),
          surfaceId: featureId,
          tabId: tabId(7),
        },
        seq(0),
      )
    ).ok,
    true,
  );
  const invalidated = await scheduler.store.read();
  assert.equal(invalidated.ok && invalidated.value?.stage, "invalidated");
  assert.equal(
    (
      await scheduler.put({
        activationId: activationId("new"),
        surfaceId: featureId,
        tabId: tabId(7),
      })
    ).ok,
    true,
  );
  const pending = await scheduler.store.read();
  assert.equal(pending.ok && pending.value?.stage, "pending");
});

test("put書込み保留中の失効を追越さず最終的にinvalidatedへ進める", async () => {
  const session = new DeferredFirstWriteSession();
  const scheduler = createTransientActivationScheduler(
    createTransientActivationStore(session),
  );
  const put = scheduler.put({
    activationId: activationId("pending"),
    surfaceId: featureId,
    tabId: tabId(9),
  });
  await session.firstWriteStarted;
  const invalidate = scheduler.invalidate(tabId(9));
  assert.equal(session.writes.length, 0);
  session.release();
  assert.equal((await put).ok, true);
  assert.equal((await invalidate).ok, true);
  const record = await scheduler.store.read();
  assert.equal(record.ok && record.value?.stage, "invalidated");
});

test("invalidatedはstage前進とwatch-ready許可で上書きされない", async () => {
  const session = new MemorySession();
  const scheduler = createTransientActivationScheduler(
    createTransientActivationStore(session),
  );
  await scheduler.invalidate(tabId(10));
  await scheduler.putAtSequence(
    {
      activationId: activationId("stale"),
      surfaceId: featureId,
      tabId: tabId(10),
    },
    seq(0),
  );
  assert.deepEqual(await scheduler.advance(activationId("stale"), "received"), {
    ok: false,
    error: { kind: "invalid-stage-transition" },
  });
  const authorization = await scheduler.authorizeAfterWatchReady(
    activationId("stale"),
  );
  assert.equal(authorization.ok && authorization.value.kind, "invalidated");
  const record = await scheduler.store.read();
  assert.equal(record.ok && record.value?.stage, "invalidated");
});

test("墓標はtabごとの最大sequenceだけを保持する", async () => {
  const session = new MemorySession();
  const store = createTransientActivationStore(session);
  await store.invalidate({ tabId: tabId(1), seq: seq(5) });
  await store.invalidate({ tabId: tabId(1), seq: seq(3) });
  await store.invalidate({ tabId: tabId(2), seq: seq(4) });
  const envelope = await store.readEnvelope();
  assert.deepEqual(envelope.ok && envelope.value.tombstones, [
    { tabId: tabId(1), seq: seq(5) },
    { tabId: tabId(2), seq: seq(4) },
  ]);
});

test("checkpointはtab別最新墓標を128件以内へ剪定する", async () => {
  const session = new MemorySession();
  const scheduler = createTransientActivationScheduler(
    createTransientActivationStore(session),
  );
  for (let value = 1; value <= MAX_TRANSIENT_TOMBSTONES + 5; value += 1) {
    assert.equal((await scheduler.invalidate(tabId(value))).ok, true);
  }
  assert.equal((await scheduler.checkpoint()).ok, true);
  const envelope = session.value as TransientActivationEnvelope;
  assert.equal(envelope.tombstones.length, MAX_TRANSIENT_TOMBSTONES);
  assert.equal(
    envelope.tombstones.at(-1)?.tabId,
    tabId(MAX_TRANSIENT_TOMBSTONES + 5),
  );
});

test("支配墓標を安全に剪定できない破損状態では新規起動を拒否する", async () => {
  const session = new MemorySession();
  session.value = {
    version: 1,
    lastSequence: 200,
    record: {
      activationId: "active",
      surfaceId: "capture",
      tabId: 1,
      seq: 1,
      stage: "pending",
    },
    tombstones: Array.from({ length: 129 }, (_, index) => ({
      tabId: 1,
      seq: index + 2,
    })),
  };
  const scheduler = createTransientActivationScheduler(
    createTransientActivationStore(session),
  );
  assert.deepEqual(
    await scheduler.put({
      activationId: activationId("blocked"),
      surfaceId: featureId,
      tabId: tabId(500),
    }),
    {
      ok: false,
      error: { kind: "capacity-exceeded" },
    },
  );
});

test("checkpointは古い支配墓標を新しい非支配墓標より優先して保持する", async () => {
  const session = new MemorySession();
  session.value = {
    version: 1,
    lastSequence: 200,
    record: {
      activationId: "late",
      surfaceId: "capture",
      tabId: 1,
      seq: 1,
      stage: "pending",
    },
    tombstones: [
      { tabId: 1, seq: 2 },
      ...Array.from({ length: 128 }, (_, index) => ({
        tabId: index + 2,
        seq: index + 3,
      })),
    ],
  };
  const store = createTransientActivationStore(session);
  assert.equal((await store.checkpoint()).ok, true);
  const envelope = session.value as TransientActivationEnvelope;
  assert.equal(envelope.tombstones.length, MAX_TRANSIENT_TOMBSTONES);
  assert.equal(
    envelope.tombstones.some(
      (item) => item.tabId === tabId(1) && item.seq === seq(2),
    ),
    true,
  );
});
