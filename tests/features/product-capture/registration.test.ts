import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createFeatureRegistry } from "../../../src/application-shell/feature-registry.js";
import type {
  ApplicationFeatureRegistration,
  Availability,
  FeatureId,
} from "../../../src/application-shell/public.js";
import { createSidePanelHost } from "../../../src/application-shell/side-panel-host.js";
import { ok, type ProjectId } from "../../../src/domain/public.js";
import type { CaptureCoordinator } from "../../../src/features/product-capture/coordinator.js";
import { createProductCaptureFeatureRegistration } from "../../../src/features/product-capture/registration.js";
import { createCaptureState } from "../../../src/features/product-capture/state.js";
import type { CaptureProjectOption } from "../../../src/features/product-capture/view.js";
import {
  defaultMessageResolver,
  type MessageKey,
} from "../../../src/ui-messages/public.js";
import { collectFeatureContractViolations } from "../../contracts/application-shell-contract-kit.js";

const PROJECTS: readonly CaptureProjectOption[] = [
  {
    id: "10000000-0000-4000-8000-000000000001" as ProjectId,
    name: "架空プロジェクトA",
  },
];

const alwaysPendingCoordinator: CaptureCoordinator = {
  captureCurrentTab: () => new Promise(() => {}),
};

const createState = () =>
  createCaptureState({
    coordinator: alwaysPendingCoordinator,
    async submitDraft() {
      throw new Error("unreachable in this test");
    },
  });

test("registrationはshell契約(mount/unmount/availability)へ適合する", async () => {
  const state = createState();
  const availabilityListeners = new Set<(value: Availability) => void>();
  const registration = createProductCaptureFeatureRegistration({
    state,
    listProjects: async () => PROJECTS,
    subscribeAvailability(listener) {
      availabilityListeners.add(listener);
      return () => availabilityListeners.delete(listener);
    },
  });

  const violations = await collectFeatureContractViolations(registration, {
    emitAvailability: (availability) => {
      for (const listener of availabilityListeners) listener(availability);
    },
  });

  assert.deepEqual(violations, []);
});

test("mountは取り込み開始の案内を描画しunmountで確実に取り除く", async () => {
  const state = createState();
  const registration = createProductCaptureFeatureRegistration({
    state,
    listProjects: async () => PROJECTS,
  });
  const container = document.createElement("div");

  let handle: Awaited<ReturnType<typeof registration.mount>> | undefined;
  await act(async () => {
    handle = await registration.mount({
      container,
      operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
      reportError: () => {},
    });
  });

  assert.match(
    container.textContent ?? "",
    new RegExp(defaultMessageResolver("capture.startAction")),
  );

  await act(async () => handle?.unmount());
  await act(async () => handle?.unmount());

  assert.equal(container.textContent, "");
});

test("mount handleはcaptureStateを公開し、切り替え元としてshellが要求するスナップショット前提を満たす", async () => {
  const state = createState();
  const registration = createProductCaptureFeatureRegistration({
    state,
    listProjects: async () => PROJECTS,
  });
  const container = document.createElement("div");

  let handle: Awaited<ReturnType<typeof registration.mount>> | undefined;
  await act(async () => {
    handle = await registration.mount({
      container,
      operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
      reportError: () => {},
    });
  });

  assert.equal(typeof handle?.captureState, "function");
  const snapshot = await handle?.captureState?.();
  assert.deepEqual(snapshot, { ok: true, value: undefined });

  await act(async () => handle?.unmount());
});

/**
 * Regression coverage for the real `side-panel-host` fail-closed rule: it
 * refuses to switch away from a feature whose mount handle has no
 * `captureState`, even when the target activates successfully. Without a real
 * `captureState`, every "詳細編集" click silently failed in production
 * (`activation_failed`: "source feature does not provide an activation
 * snapshot") while unit tests that mock `openCandidateEditor` directly never
 * exercised this shell-level precondition.
 */
test("商品取り込みが表示中でも、shellは他featureへのactivation切替を拒否しない", async () => {
  const state = createState();
  const captureRegistration = createProductCaptureFeatureRegistration({
    state,
    listProjects: async () => PROJECTS,
  });
  const events: string[] = [];
  const targetId = "target" as FeatureId;
  const target: ApplicationFeatureRegistration<object, { value: string }> = {
    id: targetId,
    presentation: "persistent",
    navigation: { labelKey: "target" as MessageKey, order: 1 },
    publicApi: {},
    getAvailability: () => ({ status: "available" }),
    subscribeAvailability: () => () => {},
    async mount({ container }) {
      const marker = document.createElement("p");
      marker.dataset.feature = "target";
      container.append(marker);
      return {
        async captureState() {
          return ok(undefined);
        },
        async unmount() {
          marker.remove();
        },
      };
    },
    activation: {
      validate(intent) {
        if (
          intent.target !== "open" ||
          typeof intent.payload !== "object" ||
          intent.payload === null ||
          !("value" in intent.payload)
        )
          return {
            ok: false,
            error: { kind: "invalid_activation", detail: "" },
          };
        return ok(intent.payload as { value: string });
      },
      async activate(input) {
        events.push(`activate:${input.value}`);
        return ok(undefined);
      },
    },
  };

  const registry = createFeatureRegistry();
  assert.equal(registry.register(captureRegistration).ok, true);
  assert.equal(registry.register(target).ok, true);
  const diagnostics: string[] = [];
  const host = createSidePanelHost({
    container: document.createElement("div"),
    operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
    registry,
    onStateChange: () => {},
    reportError: (message) => diagnostics.push(message),
  });
  await act(async () => {
    await host.start();
  });

  const result = await act(async () =>
    host.activate({
      featureId: targetId,
      target: "open",
      payload: { value: "prefill" },
    }),
  );

  assert.deepEqual(result, { ok: true, value: undefined });
  assert.deepEqual(events, ["activate:prefill"]);
});

test("mountのたびにlistProjectsを呼び直し最新のproject一覧を取得する", async () => {
  const state = createState();
  let calls = 0;
  const registration = createProductCaptureFeatureRegistration({
    state,
    listProjects: async () => {
      calls += 1;
      return PROJECTS;
    },
  });
  const container = document.createElement("div");

  let handle: Awaited<ReturnType<typeof registration.mount>> | undefined;
  await act(async () => {
    handle = await registration.mount({
      container,
      operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
      reportError: () => {},
    });
  });
  assert.equal(calls, 1);

  await act(async () => handle?.unmount());
  await act(async () => {
    handle = await registration.mount({
      container,
      operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
      reportError: () => {},
    });
  });

  assert.equal(calls, 2);
  await act(async () => handle?.unmount());
});

test("mountできるstateを持たないregistrationはmountを成功と偽らない", async () => {
  const registration = createProductCaptureFeatureRegistration({});
  const container = document.createElement("div");

  await assert.rejects(
    registration.mount({
      container,
      operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
      reportError: () => {},
    }),
    /no capture state to mount/,
  );
  assert.equal(container.textContent, "");
});

test("公開APIは他featureに公開する能力を持たない凍結済みの空objectである", () => {
  const registration = createProductCaptureFeatureRegistration({
    state: createState(),
  });

  assert.deepEqual(registration.publicApi, {});
  assert.equal(Object.isFrozen(registration.publicApi), true);
});

test("navigation.labelKeyとorderは有効な値を持つ", () => {
  const registration = createProductCaptureFeatureRegistration({
    state: createState(),
  });

  assert.ok(registration.navigation.labelKey.length > 0);
  assert.ok(Number.isFinite(registration.navigation.order));
});
