import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
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
import { validateCaptureActivation } from "../../../src/features/product-capture/transient-activation.js";

const state = () =>
  createCaptureState({
    coordinator: { captureTab: async () => ok({} as never) },
    isCurrent: () => true,
    handoff: {
      prepare: () => ok({} as never),
      prepareManual: () => ({}) as never,
      conclude: async () => ok(undefined),
      retry: async () => ok(undefined),
    },
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
  assert.equal(registration.activation?.validate, validateCaptureActivation);
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
  const capture = state();
  const registration = createProductCaptureFeatureRegistration({
    state: capture,
  });
  const activation = registration.activation;
  assert.ok(activation);
  const invalidActivation = {
    ok: false,
    error: {
      kind: "invalid_activation",
      detail: "invalid product capture activation",
    },
  } as const;
  for (const invalidIntent of [
    { ...intent({ activationId: "a", tabId: 7 }), target: "other" },
    intent({ activationId: "", tabId: 7 }),
    intent({ activationId: "a", tabId: 0 }),
    intent({ activationId: "a", tabId: 1.5 }),
  ]) {
    assert.deepEqual(activation.validate(invalidIntent), invalidActivation);
    assert.equal(capture.value, null);
  }
  assert.deepEqual(
    activation.validate(intent({ activationId: "a", tabId: 7, extra: true })),
    invalidActivation,
  );
  assert.equal(capture.value, null);
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
  let handle!: Awaited<ReturnType<typeof registration.mount>>;
  await act(async () => {
    handle = await registration.mount({
      container: document.createElement("div"),
      operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
      reportError: () => {},
    });
  });
  assert.deepEqual(await handle.captureState?.(), {
    ok: true,
    value: {
      version: 1,
      activationId: request.activationId,
      tabId: request.tabId,
      requestGeneration: 1,
      handoffInFlightGeneration: null,
    },
  });
  await act(async () => handle.unmount());
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

test("handoff rollback snapshotはページ内容を持たず同じactivationを復元する", async () => {
  const capture = state();
  const registration = createProductCaptureFeatureRegistration({
    state: capture,
  });
  const snapshot = {
    version: 1,
    activationId: "rollback-a" as ActivationId,
    tabId: 11 as TargetTabId,
    requestGeneration: 4,
    handoffInFlightGeneration: 4,
  };

  let handle!: Awaited<ReturnType<typeof registration.mount>>;
  await act(async () => {
    handle = await registration.mount({
      container: document.createElement("div"),
      operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
      reportError: () => {},
      restoredState: snapshot,
    });
  });
  assert.deepEqual(capture.value, {
    status: "extracting",
    activationId: snapshot.activationId,
    tabId: snapshot.tabId,
    requestId: "rollback",
  });
  assert.equal(JSON.stringify(snapshot).includes("page"), false);

  await act(async () => handle.unmount());
  assert.equal(capture.value, null);
});

test("不正なrollback snapshotはReact mount前に拒否する", async () => {
  const capture = state();
  const registration = createProductCaptureFeatureRegistration({
    state: capture,
  });

  await assert.rejects(
    registration.mount({
      container: document.createElement("div"),
      operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
      reportError: () => {},
      restoredState: {
        version: 1,
        activationId: "rollback-a",
        tabId: 0,
        pageUrl: "https://secret.example.invalid/item",
      },
    }),
    /snapshot is invalid/,
  );
  assert.equal(capture.value, null);
});

test("restore後のReact mount失敗は復元stateをinactiveへ戻す", async () => {
  const capture = state();
  const registration = createProductCaptureFeatureRegistration({
    state: capture,
  });

  await assert.rejects(
    registration.mount({
      container: document.createTextNode("mount failure") as never,
      operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
      reportError: () => {},
      restoredState: {
        version: 1,
        activationId: "rollback-mount-failure" as ActivationId,
        tabId: 12 as TargetTabId,
        requestGeneration: 5,
        handoffInFlightGeneration: 5,
      },
    }),
  );
  assert.equal(capture.value, null);
});
