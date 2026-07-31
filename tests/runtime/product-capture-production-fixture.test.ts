import assert from "node:assert/strict";
import test from "node:test";
import { createFeatureRegistry } from "../../src/application-shell/feature-registry.js";
import type {
  ActivationId,
  ApplicationFeatureRegistration,
  FeatureId,
  TargetTabId,
} from "../../src/application-shell/public.js";
import { createSidePanelHost } from "../../src/application-shell/side-panel-host.js";
import { createTransientSurfaceController } from "../../src/application-shell/transient-surface-controller.js";
import { ok, type RequestId } from "../../src/domain/public.js";
import { createChromeCaptureRuntimePort } from "../../src/features/product-capture/chrome-runtime-port.js";
import {
  createProductCaptureFeatureRegistration,
  productCaptureFeatureId,
} from "../../src/features/product-capture/registration.js";
import { createCaptureState } from "../../src/features/product-capture/state.js";
import { createProductionCaptureChromeFixture } from "../fixtures/product-capture-production.js";

const TAB = 41 as TargetTabId;
const REQUEST = "80000000-0000-4000-8000-000000000041" as RequestId;

test("production Chrome fixtureはactiveTab付与tabだけを取得してscriptを注入する", async () => {
  const fixture = createProductionCaptureChromeFixture({
    grantedTabId: TAB,
    pageUrl: "https://catalog.example.invalid/synthetic-production-part",
  });
  const runtime = createChromeCaptureRuntimePort(fixture.chrome);

  const target = await runtime.getTab(TAB);
  assert.equal(target.ok, true);
  if (!target.ok) return;
  assert.equal((await runtime.inject(target.value, REQUEST)).ok, true);
  assert.deepEqual(fixture.observedTabsGet, [TAB]);
  assert.deepEqual(fixture.observedInjectionTabs, [TAB, TAB]);
});

test("production Chrome fixtureはactiveTab未付与のURL欠落時に注入しない", async () => {
  const fixture = createProductionCaptureChromeFixture({
    grantedTabId: null,
    pageUrl: "https://catalog.example.invalid/synthetic-production-part",
  });
  const runtime = createChromeCaptureRuntimePort(fixture.chrome);

  assert.deepEqual(await runtime.getTab(TAB), {
    ok: false,
    error: { kind: "url-unavailable" },
  });
  assert.deepEqual(fixture.observedTabsGet, [TAB]);
  assert.deepEqual(fixture.observedInjectionTabs, []);
});

test("production registrationはcontroller要求をmount前に受理し拒否時は常設面を維持する", async () => {
  const capture = createCaptureState({
    coordinator: { captureTab: async () => ok({} as never) },
    isCurrent: () => true,
    handoff: {
      prepare: () => ok({} as never),
      prepareManual: () => ({}) as never,
      conclude: async () => ok(undefined),
      retry: async () => ok(undefined),
    },
  });
  const persistentId = "fixture-planner" as FeatureId;
  const persistent: ApplicationFeatureRegistration = {
    id: persistentId,
    presentation: "persistent",
    navigation: { labelKey: "fixture" as never, order: 0 },
    publicApi: {},
    getAvailability: () => ({ status: "available" }),
    subscribeAvailability: () => () => undefined,
    mount: async () => ({ unmount: async () => undefined }),
  };
  const captureRegistration = createProductCaptureFeatureRegistration({
    state: capture,
  });
  const registry = createFeatureRegistry();
  assert.equal(registry.register(persistent).ok, true);
  assert.equal(registry.register(captureRegistration).ok, true);
  const diagnostics: string[] = [];
  const host = createSidePanelHost({
    registry,
    container: document.createElement("div"),
    operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
    onStateChange: () => {},
    reportError: (value) => diagnostics.push(value),
  });
  await host.start();
  const controller = createTransientSurfaceController({
    host: {
      getSelected: host.getSelected,
      isTransientAvailable: (id) => id === productCaptureFeatureId,
      async showTransient(request) {
        const result = await host.showTransient(request);
        return result.ok
          ? ok(undefined)
          : { ok: false, error: { kind: "transition-failed" as const } };
      },
      async restorePersistent(preferred, reason) {
        const result = await host.restorePersistent(preferred, reason);
        return result.ok
          ? ok(undefined)
          : { ok: false, error: { kind: "transition-failed" as const } };
      },
      async activate() {
        return ok(undefined);
      },
    },
  });
  await controller.start();
  const accepted = await controller.request({
    activationId: "production-fixture" as ActivationId,
    surfaceId: productCaptureFeatureId,
    tabId: TAB,
  });
  assert.equal(accepted.ok, true);
  assert.equal(capture.value?.activationId, "production-fixture");
  assert.equal(
    diagnostics.some((value) => value.includes("feature-mount-failed")),
    false,
  );
  await controller.dismiss("production-fixture" as ActivationId, "navigated");
  const rejected = await controller.request({
    activationId: "" as ActivationId,
    surfaceId: productCaptureFeatureId,
    tabId: 0 as TargetTabId,
  });
  assert.equal(rejected.ok, false);
  assert.equal(host.getSelected(), persistentId);
  await host.stop();
});
