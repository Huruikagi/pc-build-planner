import assert from "node:assert/strict";
import test from "node:test";
import { createActivationRouter } from "../../src/application-shell/activation-router.js";
import type {
  ApplicationFeatureRegistration,
  Availability,
  FeatureActivationIntent,
  FeatureId,
} from "../../src/application-shell/contracts.js";
import { createFeatureRegistry } from "../../src/application-shell/feature-registry.js";
import { err, ok } from "../../src/domain/public.js";
import type { MessageKey } from "../../src/ui-messages/public.js";

const id = (value: string) => value as FeatureId;

function feature(
  featureId: FeatureId,
  availability: Availability = { status: "available" },
): ApplicationFeatureRegistration<object, { readonly value: string }> {
  return {
    id: featureId,
    navigation: { labelKey: featureId as unknown as MessageKey, order: 1 },
    publicApi: {},
    getAvailability: () => availability,
    subscribeAvailability: () => () => undefined,
    mount: async () => ({ unmount: async () => undefined }),
    activation: {
      validate(intent) {
        if (intent.target !== "editor")
          return err({ kind: "invalid_activation", detail: "unknown target" });
        if (
          typeof intent.payload !== "object" ||
          intent.payload === null ||
          !isRecord(intent.payload) ||
          typeof intent.payload.value !== "string"
        )
          return err({ kind: "invalid_activation", detail: "invalid payload" });
        return ok({ value: intent.payload.value });
      },
      async activate(input) {
        received.push(input.value);
        return ok(undefined);
      },
    },
  };
}

const received: string[] = [];

function intent(
  featureId: FeatureId,
  target = "editor",
  payload: unknown = { value: "prefill" },
): FeatureActivationIntent {
  return { featureId, target, payload };
}

test("検証済みactivationだけを対象featureへ一度配送する", async () => {
  received.length = 0;
  const registry = createFeatureRegistry();
  const target = feature(id("target"));
  assert.equal(registry.register(target).ok, true);
  const router = createActivationRouter({ registry });

  const prepared = router.prepare(intent(target.id));
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  assert.equal(prepared.value.feature, registry.snapshot()[0]);
  assert.equal((await prepared.value.activate()).ok, true);
  assert.deepEqual(received, ["prefill"]);
  assert.deepEqual(await prepared.value.activate(), {
    ok: false,
    error: {
      kind: "activation_failed",
      detail: "activation was already delivered",
    },
  });
  assert.deepEqual(received, ["prefill"]);
});

test("未登録、利用不可、adapterなし、未知target、不正payloadを表示変更前に拒否する", () => {
  received.length = 0;
  const registry = createFeatureRegistry();
  const available = feature(id("available"));
  const unavailable = feature(id("unavailable"), {
    status: "unavailable",
    reason: "maintenance",
  });
  const noAdapter: ApplicationFeatureRegistration = {
    ...withoutActivation(feature(id("no-adapter"))),
  };
  assert.equal(registry.register(available).ok, true);
  assert.equal(registry.register(unavailable).ok, true);
  assert.equal(registry.register(noAdapter).ok, true);
  const router = createActivationRouter({ registry });

  const rejected = [
    router.prepare(intent(id("missing"))),
    router.prepare(intent(unavailable.id)),
    router.prepare(intent(noAdapter.id)),
    router.prepare(intent(available.id, "unknown")),
    router.prepare(intent(available.id, "editor", null)),
  ];
  assert.deepEqual(
    rejected.map((result) => result.ok),
    [false, false, false, false, false],
  );
  assert.deepEqual(
    rejected.map((result) => (result.ok ? "ok" : result.error.kind)),
    [
      "feature_not_found",
      "feature_unavailable",
      "invalid_activation",
      "invalid_activation",
      "invalid_activation",
    ],
  );
  assert.deepEqual(received, []);
});

test("adapter境界のthrowと不正なResultを安定したtyped failureへ正規化する", async () => {
  const registry = createFeatureRegistry();
  const broken: ApplicationFeatureRegistration = {
    ...feature(id("broken")),
    activation: {
      validate() {
        throw new Error("untrusted detail");
      },
      async activate() {
        return { ok: true, value: undefined };
      },
    },
  };
  assert.equal(registry.register(broken).ok, true);
  const router = createActivationRouter({ registry });
  const prepared = router.prepare(intent(broken.id));
  assert.deepEqual(prepared, {
    ok: false,
    error: {
      kind: "invalid_activation",
      detail: "activation validation rejected",
    },
  });

  const failing: ApplicationFeatureRegistration<object, object> = {
    ...feature(id("failing")),
    activation: {
      validate: () => ok<object>({}),
      async activate() {
        throw new Error("untrusted detail");
      },
    },
  };
  assert.equal(registry.register(failing).ok, true);
  const activation = router.prepare(intent(failing.id));
  assert.equal(activation.ok, true);
  if (!activation.ok) return;
  assert.deepEqual(await activation.value.activate(), {
    ok: false,
    error: { kind: "activation_failed", detail: "activation rejected" },
  });
});

function withoutActivation<TActivation>(
  registration: ApplicationFeatureRegistration<object, TActivation>,
): ApplicationFeatureRegistration {
  const { activation: _activation, ...without } = registration;
  return without;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
