import assert from "node:assert/strict";
import test from "node:test";

import type {
  ProjectId,
  Result,
  UtcTimestamp,
  Uuid,
} from "../../../src/domain/public.js";
import {
  type BuildProjectAvailability,
  type BuildProjectSwitch,
  CURRENT_BUILD_DRAFT_GUARD_ID,
  createCurrentBuildProjectContextAdapter,
} from "../../../src/features/current-build/project-context-adapter.js";
import type {
  ProjectContextChangeGuard,
  ProjectContextSnapshot,
} from "../../../src/project-context/public.js";

const projectA = "10000000-0000-4000-8000-0000000000a1" as Uuid as ProjectId;
const projectB = "10000000-0000-4000-8000-0000000000b2" as Uuid as ProjectId;

const catalogItem = (id: ProjectId) => ({
  id,
  name: "架空プロジェクト",
  updatedAt: "2026-08-11T00:00:00.000Z" as UtcTimestamp,
});

const ready = (
  generation: number,
  selectedProjectId: ProjectId,
): ProjectContextSnapshot => ({
  status: "ready",
  generation,
  catalog: [catalogItem(selectedProjectId)],
  selectedProjectId,
});

const empty = (generation: number): ProjectContextSnapshot => ({
  status: "empty",
  generation,
  catalog: [],
  selectedProjectId: null,
});

const unavailable = (generation: number): ProjectContextSnapshot => ({
  status: "unavailable",
  generation,
  selectedProjectId: null,
  reason: "catalog-unavailable",
});

/** 実 project-context を合成せずに read 通知と guard 登録だけを再現する。 */
const createContextHarness = (initial: ProjectContextSnapshot) => {
  let snapshot = initial;
  const listeners = new Set<(value: ProjectContextSnapshot) => void>();
  let registered: ProjectContextChangeGuard | undefined;
  let releases = 0;
  let registrationFails = false;
  return {
    get registeredGuard() {
      return registered;
    },
    get releaseCount() {
      return releases;
    },
    get readSubscriberCount() {
      return listeners.size;
    },
    failRegistration() {
      registrationFails = true;
    },
    publish(next: ProjectContextSnapshot) {
      snapshot = next;
      for (const listener of [...listeners]) listener(next);
    },
    /** generation を進めずに同じ内容を再通知する経路。 */
    republish() {
      for (const listener of [...listeners]) listener(snapshot);
    },
    read: {
      getSnapshot: () => snapshot,
      subscribe(listener: (value: ProjectContextSnapshot) => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    guards: {
      register(guard: ProjectContextChangeGuard) {
        if (registrationFails)
          return {
            ok: false as const,
            error: { kind: "duplicate-guard" as const },
          };
        registered = guard;
        return {
          ok: true as const,
          value: () => {
            releases += 1;
          },
        };
      },
    },
  };
};

const deferred = <T>() => {
  let settle: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
};

test("readyのcontextからはproject IDを含むavailabilityだけを射影する", () => {
  const context = createContextHarness(ready(4, projectA));
  const adapter = createCurrentBuildProjectContextAdapter(context);

  assert.deepEqual(adapter.getCurrent(), {
    status: "ready",
    generation: 4,
    projectId: projectA,
  });
});

test("emptyとunavailableではproject IDを公開せず独自fallbackもしない", () => {
  const context = createContextHarness(empty(2));
  const adapter = createCurrentBuildProjectContextAdapter(context);

  assert.deepEqual(adapter.getCurrent(), { status: "empty", generation: 2 });

  context.publish(unavailable(3));
  assert.deepEqual(adapter.getCurrent(), {
    status: "unavailable",
    generation: 3,
  });
});

test("購読は古いgenerationを無視し、同じavailabilityの再通知を抑止する", () => {
  const context = createContextHarness(ready(5, projectA));
  const adapter = createCurrentBuildProjectContextAdapter(context);
  const observed: BuildProjectAvailability[] = [];
  const unsubscribe = adapter.subscribe((value) => observed.push(value));

  context.publish(ready(6, projectB));
  // 同じ snapshot の再通知（generation も内容も不変）。
  context.republish();
  // generation だけ進むが current-build から見た内容は同じ。
  context.publish(ready(7, projectB));
  // 逆転した generation は採用しない。
  context.publish(ready(3, projectA));
  context.publish(empty(8));

  assert.deepEqual(observed, [
    { status: "ready", generation: 6, projectId: projectB },
    { status: "empty", generation: 8 },
  ]);

  unsubscribe();
  context.publish(ready(9, projectA));
  assert.deepEqual(observed.length, 2);
  assert.equal(context.readSubscriberCount, 0);
});

test("guardはowner-localなtokenと切替情報を渡し、allow判断だけをcontextへ返す", async () => {
  const context = createContextHarness(ready(5, projectA));
  const adapter = createCurrentBuildProjectContextAdapter(context);
  const seen: BuildProjectSwitch[] = [];
  const registration = adapter.registerDraftGuard({
    async evaluate(change) {
      seen.push(change);
      return { ok: true, value: "allow" };
    },
    notifyForced() {},
  });

  assert.equal(registration.ok, true);
  const guard = context.registeredGuard;
  assert.ok(guard);
  assert.equal(guard.id, CURRENT_BUILD_DRAFT_GUARD_ID);

  assert.deepEqual(
    await guard.evaluate({
      kind: "select-project",
      from: projectA,
      to: projectB,
      cause: "user",
    }),
    { ok: true, value: { kind: "allow" } },
  );
  assert.equal(seen.length, 1);
  const change = seen[0];
  assert.ok(change);
  assert.equal(change.from, projectA);
  assert.equal(change.to, projectB);
  assert.equal(change.cause, "user");
  assert.equal(change.baseGeneration, 5);
  assert.equal(typeof change.token, "string");
  assert.notEqual(change.token, "");
});

for (const kind of ["guard-declined", "stale-request"] as const) {
  test(`owner側の${kind}はallowにならずcontextの切替を止める`, async () => {
    const context = createContextHarness(ready(5, projectA));
    const adapter = createCurrentBuildProjectContextAdapter(context);
    adapter.registerDraftGuard({
      async evaluate() {
        return { ok: false, error: { kind } };
      },
      notifyForced() {},
    });
    const guard = context.registeredGuard;
    assert.ok(guard);

    assert.deepEqual(
      await guard.evaluate({
        kind: "select-project",
        from: projectA,
        to: projectB,
        cause: "user",
      }),
      { ok: false, error: { kind: "guard-failed" } },
    );
  });
}

test("確認完了前にgenerationが進んだ結果はallowとしてcontextへ返さない", async () => {
  const context = createContextHarness(ready(5, projectA));
  const adapter = createCurrentBuildProjectContextAdapter(context);
  const pending =
    deferred<Result<"allow", { readonly kind: "guard-declined" }>>();
  adapter.registerDraftGuard({
    evaluate: () => pending.promise,
    notifyForced() {},
  });
  const guard = context.registeredGuard;
  assert.ok(guard);

  const evaluated = guard.evaluate({
    kind: "select-project",
    from: projectA,
    to: projectB,
    cause: "user",
  });
  context.publish(ready(6, projectA));
  pending.settle({ ok: true, value: "allow" });

  assert.deepEqual(await evaluated, {
    ok: false,
    error: { kind: "guard-failed" },
  });
});

test("後続の評価に追い越された古い要求はallowを返さない", async () => {
  const context = createContextHarness(ready(5, projectA));
  const adapter = createCurrentBuildProjectContextAdapter(context);
  const first =
    deferred<Result<"allow", { readonly kind: "guard-declined" }>>();
  let calls = 0;
  adapter.registerDraftGuard({
    evaluate: () => {
      calls += 1;
      return calls === 1
        ? first.promise
        : Promise.resolve({ ok: true as const, value: "allow" as const });
    },
    notifyForced() {},
  });
  const guard = context.registeredGuard;
  assert.ok(guard);

  const stale = guard.evaluate({
    kind: "select-project",
    from: projectA,
    to: projectB,
    cause: "user",
  });
  const fresh = await guard.evaluate({
    kind: "select-project",
    from: projectA,
    to: projectB,
    cause: "user",
  });
  first.settle({ ok: true, value: "allow" });

  assert.deepEqual(fresh, { ok: true, value: { kind: "allow" } });
  assert.deepEqual(await stale, {
    ok: false,
    error: { kind: "guard-failed" },
  });
});

test("owner評価の例外はcontextへguard-failedとして閉じ込める", async () => {
  const context = createContextHarness(ready(5, projectA));
  const adapter = createCurrentBuildProjectContextAdapter(context);
  adapter.registerDraftGuard({
    evaluate() {
      throw new Error("owner failure");
    },
    notifyForced() {},
  });
  const guard = context.registeredGuard;
  assert.ok(guard);

  assert.deepEqual(
    await guard.evaluate({
      kind: "select-project",
      from: projectA,
      to: projectB,
      cause: "user",
    }),
    { ok: false, error: { kind: "guard-failed" } },
  );
});

test("forced変更は保存も破棄も代行せずfeature所有者へ通知する", async () => {
  const context = createContextHarness(ready(5, projectA));
  const adapter = createCurrentBuildProjectContextAdapter(context);
  const forced: BuildProjectSwitch[] = [];
  let evaluations = 0;
  adapter.registerDraftGuard({
    async evaluate() {
      evaluations += 1;
      return { ok: true, value: "allow" };
    },
    notifyForced: (change) => forced.push(change),
  });
  const guard = context.registeredGuard;
  assert.ok(guard);

  await guard.notifyForced?.({
    kind: "select-project",
    from: projectA,
    to: null,
    cause: "catalog-invalidated",
  });
  await guard.notifyForced?.({
    kind: "replace-catalog",
    from: projectA,
    cause: "backup-restore",
  });

  assert.equal(evaluations, 0);
  assert.deepEqual(
    forced.map(({ from, to, cause }) => ({ from, to, cause })),
    [
      { from: projectA, to: null, cause: "catalog-invalidated" },
      { from: projectA, to: null, cause: "backup-restore" },
    ],
  );
});

test("guard登録の解除は一度だけ効き、解除後の評価と通知はownerへ届かない", async () => {
  const context = createContextHarness(ready(5, projectA));
  const adapter = createCurrentBuildProjectContextAdapter(context);
  let evaluations = 0;
  let notifications = 0;
  const registration = adapter.registerDraftGuard({
    async evaluate() {
      evaluations += 1;
      return { ok: true, value: "allow" };
    },
    notifyForced() {
      notifications += 1;
    },
  });
  assert.ok(registration.ok);
  const guard = context.registeredGuard;
  assert.ok(guard);

  registration.value();
  registration.value();
  assert.equal(context.releaseCount, 1);

  assert.deepEqual(
    await guard.evaluate({
      kind: "select-project",
      from: projectA,
      to: projectB,
      cause: "user",
    }),
    { ok: true, value: { kind: "allow" } },
  );
  await guard.notifyForced?.({
    kind: "select-project",
    from: projectA,
    to: projectB,
    cause: "user",
  });
  assert.equal(evaluations, 0);
  assert.equal(notifications, 0);
});

test("guard登録失敗は判別可能なadapter errorになる", () => {
  const context = createContextHarness(ready(5, projectA));
  context.failRegistration();
  const adapter = createCurrentBuildProjectContextAdapter(context);

  assert.deepEqual(
    adapter.registerDraftGuard({
      async evaluate() {
        return { ok: true, value: "allow" };
      },
      notifyForced() {},
    }),
    { ok: false, error: { kind: "guard-registration-failed" } },
  );
});
