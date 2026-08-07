import assert from "node:assert/strict";
import test from "node:test";

import { createActivationRouter } from "../../src/application-shell/activation-router.js";
import type {
  ApplicationFeatureRegistration,
  FeatureActivationIntent,
  FeatureId,
} from "../../src/application-shell/contracts.js";
import { createFeatureRegistry } from "../../src/application-shell/feature-registry.js";
import { ok } from "../../src/domain/public.js";
import { validateCandidateEditorPrefill } from "../../src/features/candidate-management/pre-edit-validation.js";
import { validateCaptureActivation } from "../../src/features/product-capture/transient-activation.js";
import {
  createChromeFoundationMessageTarget,
  type RuntimeMessageListener,
} from "../../src/runtime/foundation-message-target.js";
import { createTransientActivationStore } from "../../src/runtime/transient-activation-store.js";
import {
  createTransientActivationPanelPort,
  registerTransientWatchReadyListener,
} from "../../src/runtime/transient-activation-transport.js";

test("runtime/activation wave は未検証値を通知・処理・state・logへ渡さない", async () => {
  const payloadLogs: unknown[] = [];
  const originalError = console.error;
  const originalLog = console.log;
  console.error = (...values) => payloadLogs.push(values);
  console.log = (...values) => payloadLogs.push(values);
  try {
    let subscriberCalls = 0;
    const store = createTransientActivationStore({
      async get() {
        return {
          version: 1,
          lastSequence: 1,
          tombstones: [],
          record: {
            activationId: "activation-a",
            surfaceId: "product-capture",
            tabId: 7,
            seq: 1,
            stage: "pending",
            payload: "https://secret.example.invalid/product",
          },
        };
      },
      async set() {
        throw new Error("invalid value must not be written");
      },
    });
    store.subscribe(() => {
      subscriberCalls += 1;
    });
    assert.deepEqual(await store.read(), {
      ok: false,
      error: { kind: "corrupt-envelope" },
    });
    assert.equal(subscriberCalls, 0);

    let listener: RuntimeMessageListener | undefined;
    let schedulerCalls = 0;
    const runtime = {
      id: "extension-id",
      getURL: (path: string) => `chrome-extension://extension-id/${path}`,
      onMessage: {
        addListener(value: RuntimeMessageListener) {
          listener = value;
        },
        removeListener() {},
      },
    };
    registerTransientWatchReadyListener(runtime, {
      async authorizeAfterWatchReady() {
        schedulerCalls += 1;
        return { ok: false, error: { kind: "activation-not-found" } };
      },
    });
    const response = await new Promise<unknown>((resolve) =>
      listener?.(
        {
          version: 1,
          kind: "transient-watch-ready",
          activationId: "activation-a",
          payload: "https://secret.example.invalid/product",
        },
        { id: runtime.id, url: runtime.getURL("side-panel.html") },
        resolve,
      ),
    );
    assert.deepEqual(response, {
      version: 1,
      ok: false,
      code: "invalid-message",
    });
    assert.equal(schedulerCalls, 0);

    const panel = createTransientActivationPanelPort({
      async sendMessage() {
        return {
          version: 1,
          ok: true,
          decision: { payload: "https://secret.example.invalid/product" },
        };
      },
    });
    assert.deepEqual(
      await panel.authorizeAfterWatchReady("activation-a" as never),
      { ok: false, error: { kind: "invalid-message" } },
    );

    const captureIntent: FeatureActivationIntent = {
      featureId: "product-capture" as FeatureId,
      target: "capture",
      payload: {
        activationId: "activation-a",
        tabId: 7,
        payload: "https://secret.example.invalid/product",
      },
    };
    assert.equal(validateCaptureActivation(captureIntent).ok, false);

    let activationCalls = 0;
    const feature: ApplicationFeatureRegistration<object, object> = {
      id: "synthetic" as FeatureId,
      presentation: "persistent",
      navigation: { labelKey: "synthetic" as never, order: 1 },
      publicApi: {},
      getAvailability: () => ({ status: "available" }),
      subscribeAvailability: () => () => {},
      mount: async () => ({ unmount: async () => {} }),
      activation: {
        validate: () => ({ ok: true, value: {}, extra: true }) as never,
        async activate() {
          activationCalls += 1;
          return ok(undefined);
        },
      },
    };
    const registry = createFeatureRegistry();
    assert.equal(registry.register(feature).ok, true);
    assert.equal(
      createActivationRouter({ registry }).prepare({
        featureId: feature.id,
        target: "synthetic",
        payload: "https://secret.example.invalid/product",
      }).ok,
      false,
    );
    assert.equal(activationCalls, 0);
    assert.deepEqual(payloadLogs, []);
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }
});

test("valid synthetic fixture は foundation から feature state まで一度だけ配送する", async () => {
  const runtimeListeners: RuntimeMessageListener[] = [];
  const runtime = {
    id: "extension-id",
    getURL: (path: string) => `chrome-extension://extension-id/${path}`,
    onMessage: {
      addListener(listener: RuntimeMessageListener) {
        runtimeListeners.push(listener);
      },
      removeListener() {},
    },
  };
  const foundationCallers: unknown[] = [];
  createChromeFoundationMessageTarget(runtime).addHandler(
    async (_command, caller) => {
      foundationCallers.push(caller);
      return { ok: false, error: { code: "invalid-message" } };
    },
  );
  runtimeListeners[0]?.(
    { kind: "query-root" },
    { id: runtime.id, url: runtime.getURL("side-panel.html") },
    () => {},
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(foundationCallers, [{ kind: "trusted-extension" }]);

  let persisted: unknown;
  const store = createTransientActivationStore({
    async get() {
      return persisted;
    },
    async set(value) {
      persisted = structuredClone(value);
    },
  });
  assert.equal(
    (
      await store.put({
        activationId: "activation-valid" as never,
        surfaceId: "product-capture" as FeatureId,
        tabId: 7 as never,
        seq: 1 as never,
        stage: "pending",
      })
    ).ok,
    true,
  );

  let transportListener: RuntimeMessageListener | undefined;
  const transportRuntime = {
    ...runtime,
    onMessage: {
      addListener(listener: RuntimeMessageListener) {
        transportListener = listener;
      },
      removeListener() {},
    },
  };
  registerTransientWatchReadyListener(transportRuntime, {
    authorizeAfterWatchReady: (activationId) =>
      store.authorizeAfterWatchReady(activationId),
  });
  const panel = createTransientActivationPanelPort({
    sendMessage: (message) =>
      new Promise((resolve) =>
        transportListener?.(
          message,
          {
            id: transportRuntime.id,
            url: transportRuntime.getURL("side-panel.html"),
          },
          resolve,
        ),
      ),
  });
  const authorized = await panel.authorizeAfterWatchReady(
    "activation-valid" as never,
  );
  assert.equal(authorized.ok && authorized.value.kind, "authorized");
  if (!authorized.ok) return;

  let captureSession: unknown = null;
  let editorState: unknown = null;
  let pendingState: unknown = null;
  const captureFeature: ApplicationFeatureRegistration<object, object> = {
    id: "product-capture" as FeatureId,
    presentation: "persistent",
    navigation: { labelKey: "capture" as never, order: 1 },
    publicApi: {},
    getAvailability: () => ({ status: "available" }),
    subscribeAvailability: () => () => {},
    mount: async () => ({ unmount: async () => {} }),
    activation: {
      validate: validateCaptureActivation,
      async activate(input) {
        captureSession = input;
        return ok(undefined);
      },
    },
  };
  const candidateFeature: ApplicationFeatureRegistration<object, object> = {
    ...captureFeature,
    id: "candidate-management" as FeatureId,
    activation: {
      validate(intent) {
        const decoded = validateCandidateEditorPrefill(intent.payload);
        return decoded.ok
          ? decoded
          : {
              ok: false as const,
              error: {
                kind: "invalid_activation" as const,
                detail: "candidate editor prefill is invalid",
              },
            };
      },
      async activate(input) {
        editorState = input;
        pendingState = null;
        return ok(undefined);
      },
    },
  };
  const registry = createFeatureRegistry();
  assert.equal(registry.register(captureFeature).ok, true);
  assert.equal(registry.register(candidateFeature).ok, true);
  const router = createActivationRouter({ registry });
  const capture = router.prepare({
    featureId: captureFeature.id,
    target: "capture",
    payload: {
      activationId: authorized.value.record.activationId,
      tabId: authorized.value.record.tabId,
    },
  });
  assert.equal(capture.ok, true);
  if (capture.ok) assert.equal((await capture.value.activate()).ok, true);
  assert.deepEqual(captureSession, {
    activationId: "activation-valid",
    tabId: 7,
  });

  const candidate = router.prepare({
    featureId: candidateFeature.id,
    target: "open-candidate-editor",
    payload: {
      draft: {
        category: "uncategorized",
        product: { name: { original: "架空候補" } },
        normalizedAttributes: { category: "uncategorized" },
      },
    },
  });
  assert.equal(candidate.ok, true);
  if (candidate.ok) assert.equal((await candidate.value.activate()).ok, true);
  assert.notEqual(editorState, null);
  assert.equal(pendingState, null);
});
