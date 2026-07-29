import assert from "node:assert/strict";
import test from "node:test";
import { createFeatureRegistry } from "../../../src/application-shell/feature-registry.js";
import {
  type ApplicationFeatureRegistration,
  type FeatureId,
  isPersistent,
  type TransientApplicationFeatureRegistration,
} from "../../../src/application-shell/public.js";
import { productCaptureFeatureId } from "../../../src/features/product-capture/public.js";

const persistent = (
  id: string,
  order: number,
): ApplicationFeatureRegistration => ({
  id: id as FeatureId,
  presentation: "persistent",
  navigation: { labelKey: "nav.settings", order },
  publicApi: {},
  getAvailability: () => ({ status: "available" }),
  subscribeAvailability: () => () => {},
  mount: async () => ({ unmount: async () => {} }),
});

test("settings の上流 gate は persistent だけを navigation 対象にする", () => {
  const registry = createFeatureRegistry();
  const settings = persistent("settings", 60);
  const capture: TransientApplicationFeatureRegistration = {
    id: productCaptureFeatureId,
    presentation: "transient",
    transientActivation: {
      validate: (request) => ({ ok: true, value: request }),
      accept: async () => ({ ok: true, value: { release: async () => {} } }),
    },
    publicApi: {},
    getAvailability: () => ({ status: "available" }),
    subscribeAvailability: () => () => {},
    mount: async () => ({ unmount: async () => {} }),
  };

  assert.equal(registry.register(settings).ok, true);
  assert.equal(registry.register(capture).ok, true);
  assert.deepEqual(
    registry
      .snapshot()
      .filter(isPersistent)
      .map((feature) => feature.id),
    [settings.id],
  );
  assert.equal(capture.presentation, "transient");
  assert.equal("navigation" in capture, false);
});
