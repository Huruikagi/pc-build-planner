import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { userEvent } from "@testing-library/user-event";
import { act } from "react";
import type {
  ActivationId,
  FeatureActivationIntent,
  FeatureCompositionContext,
  FeatureId,
  FeatureMountHandle,
  TargetTabId,
  TransientSurfaceError,
  TransientSurfaceLifecyclePort,
} from "../../../src/application-shell/public.js";
import {
  createTransientSurfaceController,
  type TransientSurfaceHost,
} from "../../../src/application-shell/transient-surface-controller.js";
import { err, ok, type Result } from "../../../src/domain/public.js";
import type {
  CaptureInjectionFailure,
  CaptureRuntimePort,
  CaptureTabLookupFailure,
} from "../../../src/features/product-capture/coordinator.js";
import { createProductCaptureContribution } from "../../../src/features/product-capture/feature-contribution.js";
import { productCaptureFeatureId } from "../../../src/features/product-capture/registration.js";
import {
  type CaptureRollbackState,
  createCaptureState,
} from "../../../src/features/product-capture/state.js";
import { actWrappedRegistrationFactory } from "../../act-wrapped-registration.js";

const A = "activation-a" as ActivationId;
const B = "activation-b" as ActivationId;
const TAB = 7 as TargetTabId;
const NEXT_TAB = 8 as TargetTabId;
const PAGE_URL = "https://example.invalid/p";
const PRODUCT_NAME = "架空ケース";
const intent: FeatureActivationIntent = {
  featureId: "candidate-management" as FeatureId,
  target: "open-candidate-editor",
  payload: {},
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const surfaces: Array<{
  readonly handle: FeatureMountHandle;
  readonly container: HTMLElement;
}> = [];
afterEach(async () => {
  for (const { handle, container } of surfaces.splice(0, surfaces.length)) {
    await handle.unmount();
    container.remove();
  }
});

interface RuntimePlan {
  /** Failure the fixed-tab runtime detects directly, object for tab lookup. */
  readonly failure?: CaptureTabLookupFailure | CaptureInjectionFailure;
  readonly restrictedUrl?: boolean;
  /** Withholds the page result until released, to exercise stale generations. */
  readonly deferred?: boolean;
}

const captureRuntime = (
  plan: RuntimePlan,
): { readonly port: CaptureRuntimePort; release(): void } => {
  const waiting: Array<() => void> = [];
  const url = plan.restrictedUrl === true ? "chrome://settings" : PAGE_URL;
  return {
    port: {
      async getTab(tabId) {
        if (typeof plan.failure === "object") return err(plan.failure);
        return ok({ tabId, url });
      },
      async inject(target, requestId) {
        if (typeof plan.failure === "string") return err(plan.failure);
        if (plan.deferred === true)
          await new Promise<void>((resolve) => waiting.push(resolve));
        return ok({
          requestId,
          tabId: target.tabId,
          pageUrl: target.url,
          candidates: [
            {
              field: "name",
              rawValue: PRODUCT_NAME,
              source: "json-ld",
              sourceLabel: "name",
              documentOrder: 0,
            },
          ],
        });
      },
    },
    release() {
      for (const resolve of waiting.splice(0, waiting.length)) resolve();
    },
  };
};

type DismissOutcome = "ok" | "err" | "throw" | "deferred";
type ConcludeOutcome =
  | Extract<TransientSurfaceError, { readonly kind: "transition-failed" }>
  | "deferred-success";

/**
 * Wires the production capture contribution to a recording lifecycle seam so
 * dismiss, conclude and generation replacement are observed exactly as the
 * shell would deliver them.
 */
const harness = async (options: {
  readonly runtime: RuntimePlan;
  readonly dismiss?: DismissOutcome;
  readonly concludeOutcomes?: readonly ConcludeOutcome[];
}) => {
  const runtime = captureRuntime(options.runtime);
  const dismissOutcome = options.dismiss ?? "ok";
  const dismissed: Array<[ActivationId, string]> = [];
  const concluded: Array<[ActivationId, FeatureActivationIntent]> = [];
  const concludeOutcomes = [...(options.concludeOutcomes ?? [])];
  const requestedCapabilities = new Set<string>();
  const pendingDismiss: Array<
    (value: Result<void, TransientSurfaceError>) => void
  > = [];
  const pendingConclude: Array<
    (value: Result<void, TransientSurfaceError>) => void
  > = [];
  let current: ActivationId | null = null;

  const lifecycle: TransientSurfaceLifecyclePort = {
    isCurrent: (activationId) => activationId === current,
    waitUntilCurrent: async (activationId) => activationId === current,
    async dismiss(activationId, reason) {
      dismissed.push([activationId, reason]);
      switch (dismissOutcome) {
        case "ok":
          return ok(undefined);
        case "err":
          return err({ kind: "transition-failed" });
        case "throw":
          throw new Error("dismiss failed");
        case "deferred":
          return new Promise((resolve) => pendingDismiss.push(resolve));
      }
    },
    async conclude(activationId, handoff) {
      concluded.push([activationId, handoff]);
      const outcome = concludeOutcomes.shift();
      if (outcome === "deferred-success")
        return new Promise((resolve) => pendingConclude.push(resolve));
      if (outcome !== undefined) return err(outcome);
      return ok(undefined);
    },
  };
  /** Proves capture asks the shell for nothing beyond the typed lifecycle seam. */
  const transientSurface = new Proxy(lifecycle, {
    get(target, property, receiver) {
      requestedCapabilities.add(String(property));
      return Reflect.get(target, property, receiver);
    },
  });

  const contribution = createProductCaptureContribution(
    {} as FeatureCompositionContext,
    {
      runtime: runtime.port,
      transientSurface,
      createCandidateEditorIntent: (() => intent) as never,
    },
  );
  const composed = contribution.registration;
  if (composed.presentation !== "transient")
    throw new Error("product capture must compose as a transient surface");
  const registration = actWrappedRegistrationFactory(() => composed)();

  const container = document.createElement("div");
  document.body.append(container);
  const activate = async (activationId: ActivationId, tabId: TargetTabId) => {
    current = activationId;
    const validated = registration.transientActivation.validate({
      activationId,
      surfaceId: productCaptureFeatureId,
      tabId,
    });
    assert.equal(validated.ok, true);
    if (!validated.ok) return;
    const accepted = await registration.transientActivation.accept(
      validated.value,
    );
    assert.equal(accepted.ok, true);
  };

  await activate(A, TAB);
  const handle = await registration.mount({
    container,
    operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
    reportError: () => {},
  });
  surfaces.push({ handle, container });

  const query = (selector: string) => container.querySelector(selector);
  const user = userEvent.setup();
  return {
    dismissed,
    concluded,
    requestedCapabilities,
    query,
    text: () => container.textContent ?? "",
    async execute() {
      const start = query("[data-capture-start], [data-capture-retry]");
      assert.ok(start, "expected the explicit capture action");
      await act(async () => {
        await user.click(start);
        await flush();
      });
    },
    async replaceGeneration() {
      await act(async () => {
        await activate(B, NEXT_TAB);
      });
    },
    async releasePageResult() {
      runtime.release();
      await act(async () => {
        await flush();
      });
    },
    async releaseDismiss() {
      for (const resolve of pendingDismiss.splice(0, pendingDismiss.length))
        resolve(ok(undefined));
      await act(async () => {
        await flush();
      });
    },
    async releaseConclude() {
      for (const resolve of pendingConclude.splice(0, pendingConclude.length))
        resolve(ok(undefined));
      await act(async () => {
        await flush();
      });
    },
    async waitForConcludeCount(count: number) {
      while (concluded.length < count) await flush();
    },
  };
};

for (const failure of [
  { kind: "url-unavailable" },
  { kind: "tab-unavailable" },
] as const satisfies readonly CaptureTabLookupFailure[]) {
  test(`runtimeが直接返す${failure.kind}はcapture-invalidatedとして面を終了する`, async () => {
    const surface = await harness({ runtime: { failure } });

    await surface.execute();

    assert.deepEqual(surface.dismissed, [[A, "capture-invalidated"]]);
    assert.deepEqual(surface.concluded, []);
    // Host restoration and the new-gesture notice belong to the shell.
    assert.equal(surface.text(), "");
    assert.equal(surface.query("[data-capture-retry]"), null);
    assert.deepEqual(
      [...surface.requestedCapabilities]
        .filter(
          (capability) =>
            !["isCurrent", "dismiss", "conclude"].includes(capability),
        )
        .sort(),
      [],
    );
  });
}

test("restricted pageはdismissせず対象外案内を面に維持する", async () => {
  const surface = await harness({ runtime: { restrictedUrl: true } });

  await surface.execute();

  assert.deepEqual(surface.dismissed, []);
  assert.deepEqual(surface.concluded, []);
  assert.ok(surface.query("[role='alert']"));
  assert.equal(surface.query("[data-capture-retry]"), null);
});

test("通常のhandoffはdismissを使わずconcludeで面を終了する", async () => {
  const surface = await harness({ runtime: {} });

  await surface.execute();

  assert.deepEqual(surface.concluded, [[A, intent]]);
  assert.deepEqual(surface.dismissed, []);
  assert.equal(surface.text(), "");
});

for (const [name, reason] of [
  ["candidate受理失敗", "target-state-unavailable"],
  ["原子的conclude失敗", "target-mount-failed"],
] as const) {
  test(`${name}を区別して同じretained intentだけをretryする`, async () => {
    const surface = await harness({
      runtime: {},
      concludeOutcomes: [{ kind: "transition-failed", reason }],
    });

    await surface.execute();

    assert.deepEqual(surface.concluded, [[A, intent]]);
    assert.ok(surface.query("[data-capture-retry]"));
    assert.equal(
      surface
        .query("[data-capture-handoff-reason]")
        ?.textContent?.includes(reason),
      true,
    );

    await surface.execute();

    assert.deepEqual(surface.concluded, [
      [A, intent],
      [A, intent],
    ]);
    assert.equal(surface.text(), "");
  });
}

test("retry中の新activationは旧retained intentの後着成功を無効化する", async () => {
  const surface = await harness({
    runtime: {},
    concludeOutcomes: [
      { kind: "transition-failed", reason: "target-state-unavailable" },
      "deferred-success",
    ],
  });

  await surface.execute();
  const retry = surface.execute();
  await surface.waitForConcludeCount(2);
  await surface.replaceGeneration();
  await surface.releaseConclude();
  await retry;

  assert.deepEqual(surface.concluded, [
    [A, intent],
    [A, intent],
  ]);
  assert.ok(surface.query("[data-capture-start]"));
});

test("実controllerのsource rollback復元後にretained intentだけでretry成功する", async () => {
  let captures = 0;
  let activationAttempts = 0;
  let rollback: CaptureRollbackState | undefined;
  let controller!: ReturnType<typeof createTransientSurfaceController>;
  const state = createCaptureState({
    coordinator: {
      async captureTab() {
        captures += 1;
        return ok({} as never);
      },
    },
    isCurrent: (activationId) => controller.isCurrent(activationId),
    handoff: {
      prepare: () => ok(intent),
      prepareManual: () => intent,
      conclude: (activationId, value) =>
        controller.conclude(activationId, value),
      retry: (activationId, value) => controller.conclude(activationId, value),
    },
  });
  const host: TransientSurfaceHost = {
    getSelected: () => productCaptureFeatureId,
    isTransientAvailable: (featureId) => featureId === productCaptureFeatureId,
    async showTransient(request) {
      state.activate(request.activationId, request.tabId);
      return ok(undefined);
    },
    async restorePersistent() {
      return ok(undefined);
    },
    async activate() {
      activationAttempts += 1;
      rollback = state.captureRollbackState();
      assert.ok(rollback);
      state.deactivate();
      if (activationAttempts === 1) {
        state.restoreRollbackState(rollback);
        return err({
          kind: "transition-failed",
          reason: "target-state-unavailable",
        });
      }
      return ok(undefined);
    },
  };
  controller = createTransientSurfaceController({ host });
  assert.equal((await controller.start()).ok, true);
  assert.equal(
    (
      await controller.request({
        activationId: A,
        surfaceId: productCaptureFeatureId,
        tabId: TAB,
      })
    ).ok,
    true,
  );

  await state.startCapture();

  assert.equal(
    rollback?.handoffInFlightGeneration,
    rollback?.requestGeneration,
  );
  assert.equal(state.value?.status, "failed");
  assert.equal(controller.isCurrent(A), true);

  await state.startCapture();

  assert.equal(captures, 1);
  assert.equal(activationAttempts, 2);
  assert.equal(state.value, null);
  assert.deepEqual(controller.getSnapshot(), { kind: "inactive" });
});

test("注入失敗は失効経路と混同せず同世代の再試行を残す", async () => {
  const surface = await harness({ runtime: { failure: "unknown" } });

  await surface.execute();

  assert.deepEqual(surface.dismissed, []);
  assert.deepEqual(surface.concluded, []);
  assert.ok(surface.query("[data-capture-retry]"));
});

for (const dismiss of ["err", "throw"] as const) {
  test(`lifecycle終了の${dismiss}は成功扱いせず現行世代の失敗へ閉じる`, async () => {
    const surface = await harness({
      runtime: { failure: { kind: "url-unavailable" } },
      dismiss,
    });

    await surface.execute();

    assert.deepEqual(surface.dismissed, [[A, "capture-invalidated"]]);
    assert.deepEqual(surface.concluded, []);
    // A non-recoverable failure leaves no execute action on the surface.
    assert.ok(surface.query("[role='alert']"));
    assert.equal(surface.query("[data-capture-retry]"), null);
    assert.equal(surface.query("[data-capture-start]"), null);
    const text = surface.text();
    assert.equal(text.includes(PAGE_URL), false);
    assert.equal(text.includes("example.invalid"), false);
    assert.equal(text.includes(PRODUCT_NAME), false);
  });
}

test("dismissの遅延結果は後発activationの面を終了しない", async () => {
  const surface = await harness({
    runtime: { failure: { kind: "tab-unavailable" } },
    dismiss: "deferred",
  });

  await surface.execute();
  await surface.replaceGeneration();
  await surface.releaseDismiss();

  assert.deepEqual(surface.dismissed, [[A, "capture-invalidated"]]);
  // The replacement generation is idle and awaiting its own explicit gesture.
  assert.ok(surface.query("[data-capture-start]"));
});

test("遅延したページ結果は後発activationへhandoffされない", async () => {
  const surface = await harness({ runtime: { deferred: true } });

  await surface.execute();
  await surface.replaceGeneration();
  await surface.releasePageResult();

  assert.deepEqual(surface.concluded, []);
  assert.deepEqual(surface.dismissed, []);
  assert.ok(surface.query("[data-capture-start]"));
});
