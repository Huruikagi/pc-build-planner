import assert from "node:assert/strict";
import test from "node:test";

import type {
  ApplicationFeatureRegistration,
  Availability,
  FeatureId,
} from "../../src/application-shell/contracts.js";
import { createFeatureRegistry } from "../../src/application-shell/feature-registry.js";
import type { MessageKey } from "../../src/ui-messages/public.js";

function feature(
  id: string,
  order: number,
  initial: Availability = { status: "available" },
) {
  let availability = initial;
  const listeners = new Set<(value: Availability) => void>();
  const registration: ApplicationFeatureRegistration = {
    id: id as FeatureId,
    presentation: "persistent",
    navigation: { labelKey: `Feature ${id}` as MessageKey, order },
    publicApi: {},
    getAvailability: () => availability,
    subscribeAvailability(listener) {
      listeners.add(listener);
      let removed = false;
      return () => {
        if (removed) return;
        removed = true;
        listeners.delete(listener);
      };
    },
    async mount() {
      return { async unmount() {} };
    },
  };
  return {
    registration,
    emit(next: Availability) {
      availability = next;
      for (const listener of listeners) listener(next);
    },
  };
}

test("presentationとnavigationの矛盾を隔離し正常registrationを維持する", () => {
  const registry = createFeatureRegistry();
  assert.equal(registry.register(feature("healthy", 1).registration).ok, true);

  const invalidCandidates = [
    { ...feature("missing", 2).registration, presentation: undefined },
    { ...feature("unknown", 2).registration, presentation: "floating" },
    { ...feature("persistent-no-nav", 2).registration, navigation: undefined },
    {
      ...feature("transient-with-nav", 2).registration,
      presentation: "transient",
    },
  ];
  for (const candidate of invalidCandidates) {
    assert.equal(registry.register(candidate as never).ok, false);
    assert.deepEqual(
      registry.snapshot().map(({ id }) => id),
      ["healthy"],
    );
  }

  const transient: ApplicationFeatureRegistration = {
    id: "transient" as FeatureId,
    presentation: "transient",
    publicApi: {},
    getAvailability: () => ({ status: "available" }),
    subscribeAvailability: () => () => undefined,
    mount: async () => ({ unmount: async () => undefined }),
    transientActivation: {
      validate: (request) => ({ ok: true, value: request }),
      accept: async () => ({
        ok: true,
        value: { release: async () => undefined },
      }),
    },
  };
  assert.equal(registry.register(transient).ok, true);
  const snapshot = registry.snapshot();
  assert.equal(snapshot[1]?.presentation, "transient");
  assert.equal("navigation" in (snapshot[1] ?? {}), false);
  assert.equal(
    snapshot[1]?.presentation === "transient" &&
      typeof snapshot[1].transientActivation.accept,
    "function",
  );
});

test("transient activation adapter欠損を隔離する", () => {
  const registry = createFeatureRegistry();
  assert.equal(registry.register(feature("healthy", 1).registration).ok, true);
  const invalid = {
    id: "invalid-transient" as FeatureId,
    presentation: "transient",
    publicApi: {},
    getAvailability: () => ({ status: "available" as const }),
    subscribeAvailability: () => () => undefined,
    mount: async () => ({ unmount: async () => undefined }),
  };
  assert.deepEqual(registry.register(invalid as never), {
    ok: false,
    error: {
      kind: "invalid_registration",
      detail:
        "registration.transientActivation: validate and accept functions are required",
    },
  });
  assert.deepEqual(
    registry.snapshot().map(({ id }) => id),
    ["healthy"],
  );
});

test("登録をorder、同順位ではid順の決定的snapshotにする", () => {
  const registry = createFeatureRegistry();
  const beta = feature("beta", 10);
  const alpha = feature("alpha", 10);
  const first = feature("first", 1);

  assert.equal(registry.register(beta.registration).ok, true);
  assert.equal(registry.register(alpha.registration).ok, true);
  assert.equal(registry.register(first.registration).ok, true);
  assert.deepEqual(
    registry.snapshot().map(({ id }) => id),
    ["first", "alpha", "beta"],
  );
});

test("重複idを型付きerrorで隔離し既存featureを維持する", () => {
  const registry = createFeatureRegistry();
  const original = feature("same", 1);
  const duplicate = feature("same", 2);
  assert.equal(registry.register(original.registration).ok, true);

  assert.deepEqual(registry.register(duplicate.registration), {
    ok: false,
    error: { kind: "duplicate_feature_id", id: "same" },
  });
  assert.deepEqual(
    registry.snapshot().map(({ id }) => id),
    ["same"],
  );
});

test("未信頼な不正登録を安定診断へ変換し正常登録を継続する", () => {
  const registry = createFeatureRegistry();
  const healthy = feature("healthy", 1);
  assert.equal(registry.register(healthy.registration).ok, true);

  const invalidValues: readonly [unknown, string][] = [
    [null, "registration: object is required"],
    [{}, "registration.id: non-empty feature id is required"],
    [
      {
        ...feature("invalid", 2).registration,
        navigation: { labelKey: "", order: 2 },
      },
      "registration.navigation.labelKey: non-empty label key is required",
    ],
    [
      {
        ...feature("invalid", 2).registration,
        navigation: { labelKey: "Invalid", order: Number.NaN },
      },
      "registration.navigation.order: finite order is required",
    ],
  ];
  for (const [value, detail] of invalidValues) {
    assert.deepEqual(
      registry.register(value as ApplicationFeatureRegistration),
      { ok: false, error: { kind: "invalid_registration", detail } },
    );
  }
  assert.deepEqual(
    registry.snapshot().map(({ id }) => id),
    ["healthy"],
  );
});

test("外部availability callbackの例外と不正値を隔離する", () => {
  const registry = createFeatureRegistry();
  const throwingGet = {
    ...feature("throw-get", 1).registration,
    getAvailability(): Availability {
      throw new Error("external detail");
    },
  };
  assert.deepEqual(registry.register(throwingGet), {
    ok: false,
    error: {
      kind: "invalid_registration",
      detail: "availability.get: registration rejected",
    },
  });

  const throwingSubscribe = {
    ...feature("throw-subscribe", 1).registration,
    subscribeAvailability(): () => void {
      throw new Error("external detail");
    },
  };
  assert.deepEqual(registry.register(throwingSubscribe), {
    ok: false,
    error: {
      kind: "invalid_registration",
      detail: "availability.subscribe: registration rejected",
    },
  });
  assert.deepEqual(registry.snapshot(), []);
});

test("availability変更をsnapshotと全購読者へ同期し例外を隔離する", () => {
  const registry = createFeatureRegistry();
  const registered = feature("availability", 1);
  assert.equal(registry.register(registered.registration).ok, true);
  const notifications: string[] = [];
  registry.subscribe(() => {
    notifications.push("first");
    throw new Error("listener detail");
  });
  registry.subscribe(() => notifications.push("second"));

  registered.emit({ status: "unavailable", reason: "maintenance" });

  assert.deepEqual(registry.snapshot()[0]?.getAvailability(), {
    status: "unavailable",
    reason: "maintenance",
  });
  assert.deepEqual(notifications, ["first", "second"]);
});

test("registryとfeature availabilityの購読解除は冪等", () => {
  const registry = createFeatureRegistry();
  const registered = feature("cleanup", 1);
  assert.equal(registry.register(registered.registration).ok, true);
  let registryCalls = 0;
  const unsubscribeRegistry = registry.subscribe(() => registryCalls++);
  let availabilityCalls = 0;
  const snapshotFeature = registry.snapshot()[0];
  assert.ok(snapshotFeature);
  const unsubscribeAvailability = snapshotFeature.subscribeAvailability(
    () => availabilityCalls++,
  );

  registered.emit({ status: "unavailable", reason: "offline" });
  unsubscribeRegistry();
  unsubscribeRegistry();
  unsubscribeAvailability();
  unsubscribeAvailability();
  registered.emit({ status: "available" });

  assert.equal(registryCalls, 1);
  assert.equal(availabilityCalls, 1);
});

test("不正なavailability通知を無視して健全な購読を継続する", () => {
  const registry = createFeatureRegistry();
  const registered = feature("updates", 1);
  assert.equal(registry.register(registered.registration).ok, true);
  let calls = 0;
  registry.subscribe(() => calls++);

  registered.emit({ status: "unavailable", reason: "" });
  assert.deepEqual(registry.snapshot()[0]?.getAvailability(), {
    status: "available",
  });
  assert.equal(calls, 0);

  registered.emit({ status: "unavailable", reason: "valid" });
  assert.deepEqual(registry.snapshot()[0]?.getAvailability(), {
    status: "unavailable",
    reason: "valid",
  });
  assert.equal(calls, 1);
});
