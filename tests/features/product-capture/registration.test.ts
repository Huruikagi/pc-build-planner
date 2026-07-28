import assert from "node:assert/strict";
import test from "node:test";
import type {
  ActivationId,
  FeatureActivationIntent,
  TargetTabId,
} from "../../../src/application-shell/public.js";
import { ok } from "../../../src/domain/public.js";
import {
  createProductCaptureFeatureRegistration,
  productCaptureFeatureId,
} from "../../../src/features/product-capture/registration.js";
import { createCaptureState } from "../../../src/features/product-capture/state.js";

const state = () =>
  createCaptureState({
    coordinator: { captureTab: async () => ok({} as never) },
    isCurrent: () => true,
    createHandoffIntent: () => ok({} as never),
    conclude: async () => ok(undefined),
  });
const intent = (payload: unknown): FeatureActivationIntent => ({
  featureId: productCaptureFeatureId,
  target: "capture",
  payload,
});

test("registrationはnavigationを持たないcanonical transient memberである", () => {
  const registration = createProductCaptureFeatureRegistration({
    state: state(),
  });
  assert.equal(registration.presentation, "transient");
  assert.equal("navigation" in registration, false);
  assert.equal(typeof registration.activation?.validate, "function");
});

test("正常activationを検証し、activateごとに新しい実行contextを構築する", async () => {
  const capture = state();
  const registration = createProductCaptureFeatureRegistration({
    state: capture,
  });
  const activation = registration.activation;
  assert.ok(activation);
  const first = activation.validate(intent({ activationId: "a", tabId: 7 }));
  assert.equal(first.ok, true);
  if (!first.ok) return;
  await activation.activate(first.value);
  assert.deepEqual(capture.value, {
    status: "idle",
    activationId: "a" as ActivationId,
    tabId: 7 as TargetTabId,
  });
  const second = activation.validate(intent({ activationId: "b", tabId: 8 }));
  assert.equal(second.ok, true);
  if (second.ok) await activation.activate(second.value);
  assert.deepEqual(capture.value, {
    status: "idle",
    activationId: "b" as ActivationId,
    tabId: 8 as TargetTabId,
  });
});

test("不正activationをfail closedで拒否し、未起動mountも拒否する", async () => {
  const registration = createProductCaptureFeatureRegistration({
    state: state(),
  });
  const activation = registration.activation;
  assert.ok(activation);
  assert.equal(
    activation.validate(intent({ activationId: "", tabId: 0 })).ok,
    false,
  );
  await assert.rejects(
    registration.mount({
      container: document.createElement("div"),
      operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
      reportError: () => {},
    }),
  );
});

test("mount前にtransient requestを受理しlease解放を冪等にする", async () => {
  const capture = state();
  const registration = createProductCaptureFeatureRegistration({
    state: capture,
  });
  const request = {
    activationId: "lease-a" as ActivationId,
    surfaceId: productCaptureFeatureId,
    tabId: 9 as TargetTabId,
  };
  const validated = registration.transientActivation.validate(request);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  const accepted = await registration.transientActivation.accept(
    validated.value,
  );
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  assert.equal(capture.value?.activationId, request.activationId);
  const handle = await registration.mount({
    container: document.createElement("div"),
    operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
    reportError: () => {},
  });
  await handle.unmount();
  assert.equal(capture.value?.activationId, request.activationId);
  await accepted.value.release();
  await accepted.value.release();
  assert.equal(capture.value, null);
  assert.equal(
    registration.transientActivation.validate({
      ...request,
      surfaceId: "other" as never,
    }).ok,
    false,
  );
});
