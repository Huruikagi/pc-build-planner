import assert from "node:assert/strict";
import test from "node:test";
import { createFeatureRegistry } from "../../src/application-shell/feature-registry.js";
import type {
  ActivationId,
  ApplicationFeatureRegistration,
  FeatureCompositionContext,
  FeatureId,
  PersistentApplicationFeatureRegistration,
  TargetTabId,
  TransientActivationRequest,
  TransientApplicationFeatureRegistration,
} from "../../src/application-shell/public.js";
import { isPersistent } from "../../src/application-shell/public.js";
import { createSidePanelFeatureContributions } from "../../src/application-shell/side-panel-contributions.js";
import { createSidePanelHost } from "../../src/application-shell/side-panel-host.js";
import { ok } from "../../src/domain/public.js";
import { productCaptureFeatureId } from "../../src/features/product-capture/public.js";
import type { MessageKey } from "../../src/ui-messages/public.js";

/**
 * settings-screen task 1.1 (UpstreamContractGate).
 *
 * settingsは`transient-feature-surface`のcanonical判別共用体と
 * `product-capture-transient-migration`後の常設navigation集合を実装前提とする。
 * 前提が欠けた場合は本specへ互換shimを追加せず、ここで明示的に失敗させる。
 * 型levelの前提は`tests/tooling/public-api-consumer.ts`が
 * `pnpm typecheck:public-consumer`で固定する。
 */

const featureId = (value: string) => value as FeatureId;

const featureBase = {
  publicApi: {},
  getAvailability: () => ({ status: "available" as const }),
  subscribeAvailability: () => () => undefined,
};

function persistentProbe(
  id: string,
  order: number,
  events: string[],
  icon?: string,
): PersistentApplicationFeatureRegistration {
  return {
    ...featureBase,
    id: featureId(id),
    presentation: "persistent",
    navigation: {
      labelKey: `nav.${id}` as MessageKey,
      order,
      ...(icon === undefined ? {} : { icon }),
    },
    async mount() {
      events.push(`mount:${id}`);
      return {
        async unmount() {
          events.push(`unmount:${id}`);
        },
      };
    },
  };
}

function transientProbe(
  id: string,
  events: string[],
): TransientApplicationFeatureRegistration {
  return {
    ...featureBase,
    id: featureId(id),
    presentation: "transient",
    transientActivation: {
      validate: (request) => ok(request),
      accept: async () => ok({ release: async () => undefined }),
    },
    async mount() {
      events.push(`mount:${id}`);
      return {
        async unmount() {
          events.push(`unmount:${id}`);
        },
      };
    },
  };
}

const transientRequest = (
  surfaceId: FeatureId,
): TransientActivationRequest => ({
  activationId: "settings-gate-activation" as ActivationId,
  surfaceId,
  tabId: 7 as TargetTabId,
});

function setupHost(
  registrations: readonly ApplicationFeatureRegistration<object, unknown>[],
) {
  const registry = createFeatureRegistry();
  for (const registration of registrations) {
    assert.equal(registry.register(registration).ok, true);
  }
  const host = createSidePanelHost({
    container: document.createElement("div"),
    operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
    registry,
    onStateChange: () => undefined,
    reportError: () => undefined,
  });
  return { host, registry };
}

/** 本番と同じcatalogを組み立てるための最小context。実データには到達しない。 */
const compositionContext = (): FeatureCompositionContext => ({
  data: {
    async query() {
      return { ok: true, value: 0 } as never;
    },
    async mutate() {
      return { ok: true, value: {} } as never;
    },
  },
  fullDataPort: {
    async query() {
      return { ok: true, value: 0 } as never;
    },
    async mutate() {
      return { ok: true, value: {} } as never;
    },
    async assessReplacement() {
      return { ok: true, value: {} } as never;
    },
    async replaceRoot() {
      return { ok: true, value: {} } as never;
    },
    async runMaintenance() {
      return { ok: true, value: {} } as never;
    },
  },
  navigator: {
    async activate() {
      return { ok: true, value: undefined };
    },
  },
});

test("前提gate: canonical判別共用体が常設navigation必須と一過性navigation禁止を強制する", () => {
  const events: string[] = [];
  const registry = createFeatureRegistry();
  const persistent = persistentProbe("gate-persistent", 0, events);
  assert.equal(registry.register(persistent).ok, true);

  const persistentWithoutNavigation = {
    ...persistent,
    id: featureId("gate-persistent-no-nav"),
    navigation: undefined,
  };
  assert.deepEqual(registry.register(persistentWithoutNavigation as never), {
    ok: false,
    error: {
      kind: "invalid_registration",
      detail: "registration.navigation: object is required",
    },
  });

  const transientWithNavigation = {
    ...transientProbe("gate-transient-with-nav", events),
    navigation: { labelKey: "nav.invalid" as MessageKey, order: 1 },
  };
  assert.deepEqual(registry.register(transientWithNavigation as never), {
    ok: false,
    error: {
      kind: "invalid_registration",
      detail:
        "registration.navigation: transient registration must omit navigation",
    },
  });

  const transient = transientProbe("gate-transient", events);
  assert.equal(registry.register(transient).ok, true);

  const snapshot = registry.snapshot();
  assert.deepEqual(
    snapshot.map(({ id }) => id),
    ["gate-persistent", "gate-transient"],
  );
  const [first, second] = snapshot;
  assert.ok(first !== undefined && isPersistent(first));
  assert.equal(first.navigation.order, 0);
  assert.ok(second !== undefined && !isPersistent(second));
  assert.equal("navigation" in second, false);
  assert.equal(typeof second.transientActivation.accept, "function");
});

test("前提gate: product-captureは一過性登録で常設navigation集合に含まれない", () => {
  const contributions = createSidePanelFeatureContributions(
    compositionContext(),
  );
  const registrations: readonly ApplicationFeatureRegistration<
    object,
    unknown
  >[] = contributions.map(({ registration }) => registration);
  const persistentIds = registrations.filter(isPersistent).map(({ id }) => id);
  assert.ok(
    persistentIds.length > 0,
    "常設navigation集合が空ならgateは無意味になる",
  );
  assert.equal(persistentIds.includes(productCaptureFeatureId), false);

  const capture = registrations.find(
    ({ id }) => id === productCaptureFeatureId,
  );
  assert.ok(capture !== undefined, "product-captureがcatalogに存在しない");
  assert.equal(capture.presentation, "transient");
  assert.equal("navigation" in capture, false);
});

test("前提gate: 常設featureだけがnavigation・通常選択・初期選択・fallbackの対象になる", async () => {
  const events: string[] = [];
  // settingsが追加される常設consumerの形（order 60 + icon）を前提として検証する。
  const settingsShaped = persistentProbe(
    "gate-settings-shaped",
    60,
    events,
    "settings",
  );
  const primary = persistentProbe("gate-primary", 10, events);
  const transient = transientProbe("gate-transient-surface", events);
  const { host, registry } = setupHost([settingsShaped, primary, transient]);

  const navigation = registry
    .snapshot()
    .filter(isPersistent)
    .map((feature) => ({
      id: feature.id,
      order: feature.navigation.order,
      icon: feature.navigation.icon,
    }));
  assert.deepEqual(navigation, [
    { id: "gate-primary", order: 10, icon: undefined },
    { id: "gate-settings-shaped", order: 60, icon: "settings" },
  ]);

  // 初期選択は常設のみを対象とする。
  assert.equal((await host.start()).ok, true);
  assert.equal(host.getSelected(), primary.id);

  // 通常選択は一過性featureを受け付けない。
  const selectedTransient = await host.select(transient.id);
  assert.equal(selectedTransient.ok, false);
  assert.equal(host.getSelected(), primary.id);

  // 常設consumerは通常選択の対象になる。
  assert.equal((await host.select(settingsShaped.id)).ok, true);
  assert.equal(host.getSelected(), settingsShaped.id);

  // 一過性面の起動と終了では常設featureがfallback先になる。
  assert.equal(
    (await host.showTransient(transientRequest(transient.id))).ok,
    true,
  );
  assert.equal(host.getSelected(), transient.id);
  assert.equal(
    (await host.restorePersistent(settingsShaped.id, "navigated")).ok,
    true,
  );
  assert.equal(host.getSelected(), settingsShaped.id);

  assert.equal(
    (await host.showTransient(transientRequest(transient.id))).ok,
    true,
  );
  assert.equal((await host.restorePersistent(null, "tab-closed")).ok, true);
  assert.equal(host.getSelected(), primary.id);

  await host.stop();
});
