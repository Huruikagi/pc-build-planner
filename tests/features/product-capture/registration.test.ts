import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import type { Availability } from "../../../src/application-shell/public.js";
import type { ProjectId } from "../../../src/domain/public.js";
import type { CaptureCoordinator } from "../../../src/features/product-capture/coordinator.js";
import { createProductCaptureFeatureRegistration } from "../../../src/features/product-capture/registration.js";
import { createCaptureState } from "../../../src/features/product-capture/state.js";
import type { CaptureProjectOption } from "../../../src/features/product-capture/view.js";
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
    projects: PROJECTS,
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
    projects: PROJECTS,
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

  assert.match(container.textContent ?? "", /取り込みを開始/);

  await act(async () => handle?.unmount());
  await act(async () => handle?.unmount());

  assert.equal(container.textContent, "");
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

test("navigation.labelとorderは有効な値を持つ", () => {
  const registration = createProductCaptureFeatureRegistration({
    state: createState(),
  });

  assert.ok(registration.navigation.label.length > 0);
  assert.ok(Number.isFinite(registration.navigation.order));
});
