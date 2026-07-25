import assert from "node:assert/strict";
import test from "node:test";

import type {
  ApplicationWorkerRegistration,
  Availability,
} from "../../src/application-shell/contracts.js";

import {
  collectActivationLifecycleViolations,
  collectFeatureActivationContractViolations,
  collectFeatureContractViolations,
  composeWorkerRegistrations,
  createActivationLifecycleFixture,
  createFeatureContractFixture,
} from "./application-shell-contract-kit.js";

test("activation対応下流featureはvalidatorと適用を各一回だけ実行できる", async () => {
  const fixture = createFeatureContractFixture({ activation: true });

  assert.deepEqual(
    await collectFeatureActivationContractViolations(fixture.feature, {
      featureId: fixture.feature.id,
      target: "open-editor",
      payload: { candidateId: "fictional-candidate" },
    }),
    [],
  );
  assert.equal(fixture.observations.activationValidationCount, 1);
  assert.equal(fixture.observations.activationApplyCount, 1);
});

test("activation apply失敗時もtargetをcleanupしてopaque source stateを復元する", async () => {
  const fixture = createActivationLifecycleFixture();

  assert.deepEqual(await collectActivationLifecycleViolations(fixture), []);
  assert.equal(fixture.observations.targetMountCount, 1);
  assert.equal(fixture.observations.targetUnmountCount, 1);
  assert.equal(fixture.observations.sourceMountCount, 2);
  assert.deepEqual(fixture.observations.sourceRestoredState, {
    draft: "fictional-source-state",
  });
});

test("適合feature fixtureはmount、通知、cleanup契約を満たす", async () => {
  const fixture = createFeatureContractFixture();

  assert.deepEqual(await collectFeatureContractViolations(fixture.feature), []);
  assert.equal(fixture.observations.mountCount, 1);
  assert.equal(fixture.observations.unmountCount, 1);
  assert.equal(fixture.observations.availabilityNotifications, 1);
  assert.equal(fixture.observations.notificationsAfterUnsubscribe, 0);
  assert.equal(fixture.observations.containerAfterUnmount, "");
});

test("下流featureは固有データなしのprobeでavailability契約を検証できる", async () => {
  const fixture = createFeatureContractFixture();

  assert.deepEqual(
    await collectFeatureContractViolations(fixture.feature, {
      emitAvailability: fixture.emitAvailability,
    }),
    [],
  );
});

test("不正fixtureは違反箇所を安定した順序で報告する", async () => {
  const fixture = createFeatureContractFixture({ invalid: true });

  assert.deepEqual(await collectFeatureContractViolations(fixture.feature), [
    "registration.id: non-empty feature id is required",
    "registration.navigation.labelKey: non-empty label key is required",
    "registration.navigation.order: finite order is required",
    "availability.reason: unavailable reason is required",
    "mount: feature did not render into the supplied container",
    "availability.unsubscribe: listener was notified after unsubscribe",
  ]);
});

test("通知しない任意の下流fixtureをfield-qualified violationで拒否する", async () => {
  const fixture = createFeatureContractFixture();
  const feature = {
    ...fixture.feature,
    subscribeAvailability: () => () => {},
  };

  assert.deepEqual(
    await collectFeatureContractViolations(feature, {
      emitAvailability: () => {},
    }),
    ["availability.notification: subscribed listener was not notified"],
  );
});

test("解除が無効な任意の下流fixtureをfield-qualified violationで拒否する", async () => {
  const fixture = createFeatureContractFixture();
  const listeners = new Set<(availability: Availability) => void>();
  const feature = {
    ...fixture.feature,
    subscribeAvailability(listener: (availability: Availability) => void) {
      listeners.add(listener);
      return () => {};
    },
  };

  assert.deepEqual(
    await collectFeatureContractViolations(feature, {
      emitAvailability(availability) {
        for (const listener of listeners) listener(availability);
      },
    }),
    ["availability.unsubscribe: listener was notified after unsubscribe"],
  );
});

test("mount rejectionを安定した違反へ変換してsubscriptionを必ず解除する", async () => {
  const fixture = createFeatureContractFixture();
  const listeners = new Set<(availability: Availability) => void>();
  let callsAfterCollection = 0;
  const feature = {
    ...fixture.feature,
    subscribeAvailability(listener: (availability: Availability) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async mount() {
      throw new Error("feature-specific mount detail");
    },
  };
  const emitAvailability = (availability: Availability) => {
    for (const listener of listeners) listener(availability);
  };

  assert.deepEqual(
    await collectFeatureContractViolations(feature, { emitAvailability }),
    ["mount: registration rejected"],
  );
  emitAvailability({ status: "available" });
  callsAfterCollection += listeners.size;
  assert.equal(callsAfterCollection, 0);
});

test("missing mount handleとunmount rejectionを決定的に報告して解除する", async () => {
  const missing = createFeatureContractFixture();
  assert.deepEqual(
    await collectFeatureContractViolations(
      {
        ...missing.feature,
        mount: async () => undefined as never,
      },
      { emitAvailability: missing.emitAvailability },
    ),
    ["mount.handle: unmount handle is required"],
  );

  const rejecting = createFeatureContractFixture();
  assert.deepEqual(
    await collectFeatureContractViolations(
      {
        ...rejecting.feature,
        async mount() {
          return {
            async unmount() {
              throw new Error("feature-specific unmount detail");
            },
          };
        },
      },
      { emitAvailability: rejecting.emitAvailability },
    ),
    [
      "mount: feature did not render into the supplied container",
      "unmount.first: registration rejected",
      "unmount.second: registration rejected",
    ],
  );
});

test("availability callback例外をfield-qualified診断へ変換してmount検査を継続する", async () => {
  const getFailure = createFeatureContractFixture();
  assert.deepEqual(
    await collectFeatureContractViolations(
      {
        ...getFailure.feature,
        getAvailability() {
          throw new Error("feature detail");
        },
      },
      { emitAvailability: getFailure.emitAvailability },
    ),
    ["availability.get: registration rejected"],
  );
  assert.equal(getFailure.observations.unmountCount, 1);

  const subscribeFailure = createFeatureContractFixture();
  assert.deepEqual(
    await collectFeatureContractViolations(
      {
        ...subscribeFailure.feature,
        subscribeAvailability() {
          throw new Error("feature detail");
        },
      },
      { emitAvailability: subscribeFailure.emitAvailability },
    ),
    ["availability.subscribe: registration rejected"],
  );
  assert.equal(subscribeFailure.observations.unmountCount, 1);

  const subscribedEmitFailure = createFeatureContractFixture();
  assert.deepEqual(
    await collectFeatureContractViolations(subscribedEmitFailure.feature, {
      emitAvailability() {
        throw new Error("fixture detail");
      },
    }),
    [
      "availability.emit.subscribed: probe rejected",
      "availability.notification: subscribed listener was not notified",
      "availability.emit.unsubscribed: probe rejected",
    ],
  );

  const postUnsubscribeEmitFailure = createFeatureContractFixture();
  let emitCount = 0;
  assert.deepEqual(
    await collectFeatureContractViolations(postUnsubscribeEmitFailure.feature, {
      emitAvailability(availability) {
        emitCount += 1;
        if (emitCount === 2) throw new Error("fixture detail");
        postUnsubscribeEmitFailure.emitAvailability(availability);
      },
    }),
    ["availability.emit.unsubscribed: probe rejected"],
  );
  assert.equal(
    postUnsubscribeEmitFailure.observations.notificationsAfterUnsubscribe,
    0,
  );
});

test("availability unsubscribe例外でも二回cleanupし、解除後通知検査まで継続する", async () => {
  const fixture = createFeatureContractFixture();
  const listeners = new Set<(availability: Availability) => void>();
  let cleanupCalls = 0;
  const feature = {
    ...fixture.feature,
    subscribeAvailability(listener: (availability: Availability) => void) {
      listeners.add(listener);
      return () => {
        cleanupCalls += 1;
        listeners.delete(listener);
        throw new Error("feature cleanup detail");
      };
    },
  };

  assert.deepEqual(
    await collectFeatureContractViolations(feature, {
      emitAvailability(availability) {
        for (const listener of listeners) listener(availability);
      },
    }),
    [
      "availability.unsubscribe.first: cleanup rejected",
      "availability.unsubscribe.second: cleanup rejected",
    ],
  );
  assert.equal(cleanupCalls, 2);
  assert.equal(listeners.size, 0);
});

test("availability cleanupが関数でない場合は同一診断でmount lifecycleを継続する", async () => {
  const invalidCleanupCandidates: readonly unknown[] = [
    undefined,
    null,
    false,
    0,
    "",
    true,
    1,
    "cleanup",
    {},
    [],
  ];

  for (const candidate of invalidCleanupCandidates) {
    const fixture = createFeatureContractFixture();
    const feature = {
      ...fixture.feature,
      subscribeAvailability() {
        return candidate as () => void;
      },
    };

    assert.deepEqual(await collectFeatureContractViolations(feature), [
      "availability.unsubscribe: cleanup function is required",
    ]);
    assert.equal(fixture.observations.mountCount, 1);
    assert.equal(fixture.observations.unmountCount, 1);
  }
});

test("worker registrationは一意で、解除は冪等", () => {
  const fixture = createFeatureContractFixture();
  const composed = composeWorkerRegistrations(
    [fixture.worker],
    fixture.workerContext,
  );

  assert.equal(composed.ok, true);
  if (!composed.ok) return;
  assert.equal(fixture.observations.activeActionHandlers, 1);
  composed.value();
  composed.value();
  assert.equal(fixture.observations.activeActionHandlers, 0);
});

test("worker registration重複と途中失敗は決定的にcleanupする", () => {
  const duplicate = createFeatureContractFixture();
  const duplicateResult = composeWorkerRegistrations(
    [duplicate.worker, duplicate.worker],
    duplicate.workerContext,
  );
  assert.deepEqual(duplicateResult, {
    ok: false,
    error: { kind: "duplicate_feature_id", id: "contract-fixture" },
  });
  assert.equal(duplicate.observations.activeActionHandlers, 0);

  const invalidId = {
    ...duplicate.worker,
    id: "" as typeof duplicate.worker.id,
  };
  assert.deepEqual(
    composeWorkerRegistrations([invalidId], duplicate.workerContext),
    {
      ok: false,
      error: {
        kind: "invalid_registration",
        detail: "worker.id: non-empty feature id is required",
      },
    },
  );

  const partial = createFeatureContractFixture({ failingWorker: true });
  const partialResult = composeWorkerRegistrations(
    [duplicate.worker, partial.worker],
    duplicate.workerContext,
  );
  assert.equal(partialResult.ok, false);
  assert.equal(duplicate.observations.activeActionHandlers, 0);
});

test("worker register throwを型付きerrorへ変換し、既存登録を逆順rollbackする", () => {
  const order: string[] = [];
  const diagnostics: string[] = [];
  const worker = (id: string): ApplicationWorkerRegistration => ({
    id: id as ApplicationWorkerRegistration["id"],
    register: () => ({ ok: true, value: () => order.push(id) }),
  });
  const throwing: ApplicationWorkerRegistration = {
    id: "throwing" as ApplicationWorkerRegistration["id"],
    register() {
      throw new Error("worker detail");
    },
  };

  assert.deepEqual(
    composeWorkerRegistrations([worker("first"), worker("second"), throwing], {
      addActionHandler: () => () => {},
      reportError: (message) => diagnostics.push(message),
    }),
    {
      ok: false,
      error: {
        kind: "invalid_registration",
        detail: "worker.register: registration rejected",
      },
    },
  );
  assert.deepEqual(order, ["second", "first"]);
  assert.deepEqual(diagnostics, []);
});

test("worker rollbackは複数cleanup例外を隔離し、全件を逆順に診断する", () => {
  const order: string[] = [];
  const diagnostics: string[] = [];
  const registration = (id: string): ApplicationWorkerRegistration => ({
    id: id as ApplicationWorkerRegistration["id"],
    register: () => ({
      ok: true,
      value: () => {
        order.push(id);
        throw new Error("cleanup detail");
      },
    }),
  });
  const failing: ApplicationWorkerRegistration = {
    id: "failure" as ApplicationWorkerRegistration["id"],
    register: () => ({
      ok: false,
      error: { kind: "invalid_registration", detail: "fixture failure" },
    }),
  };

  const result = composeWorkerRegistrations(
    [registration("first"), registration("second"), failing],
    {
      addActionHandler: () => () => {},
      reportError(message) {
        diagnostics.push(message);
        if (diagnostics.length === 1) throw new Error("reporter detail");
      },
    },
  );
  assert.deepEqual(result, {
    ok: false,
    error: { kind: "invalid_registration", detail: "fixture failure" },
  });
  assert.deepEqual(order, ["second", "first"]);
  assert.deepEqual(diagnostics, [
    "worker.cleanup[second]: cleanup rejected",
    "worker.cleanup[first]: cleanup rejected",
  ]);
});

test("worker normal cleanupも逆順・best-effort・冪等で診断する", () => {
  const order: string[] = [];
  const diagnostics: string[] = [];
  const registration = (
    id: string,
    throws: boolean,
  ): ApplicationWorkerRegistration => ({
    id: id as ApplicationWorkerRegistration["id"],
    register: () => ({
      ok: true,
      value: () => {
        order.push(id);
        if (throws) throw new Error("cleanup detail");
      },
    }),
  });
  const result = composeWorkerRegistrations(
    [
      registration("first", true),
      registration("second", true),
      registration("third", false),
    ],
    {
      addActionHandler: () => () => {},
      reportError: (message) => diagnostics.push(message),
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  result.value();
  result.value();
  assert.deepEqual(order, ["third", "second", "first"]);
  assert.deepEqual(diagnostics, [
    "worker.cleanup[second]: cleanup rejected",
    "worker.cleanup[first]: cleanup rejected",
  ]);
});
