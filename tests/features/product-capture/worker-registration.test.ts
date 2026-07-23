import assert from "node:assert/strict";
import test from "node:test";
import type { WorkerRegistrationContext } from "../../../src/application-shell/public.js";
import type { CaptureCoordinator } from "../../../src/features/product-capture/coordinator.js";
import { productCaptureFeatureId } from "../../../src/features/product-capture/public.js";
import { createCaptureState } from "../../../src/features/product-capture/state.js";
import { createCaptureWorkerRegistration } from "../../../src/features/product-capture/worker-registration.js";
import { composeWorkerRegistrations } from "../../contracts/application-shell-contract-kit.js";

const pendingCoordinator: CaptureCoordinator = {
  captureCurrentTab: () => new Promise(() => {}),
};

interface Harness {
  readonly context: WorkerRegistrationContext;
  readonly handlers: Map<string, () => Promise<void>>;
  readonly reports: string[];
}

const harness = (): Harness => {
  const handlers = new Map<string, () => Promise<void>>();
  const reports: string[] = [];
  return {
    handlers,
    reports,
    context: {
      addActionHandler(id, handler) {
        handlers.set(id, handler);
        return () => {
          handlers.delete(id);
        };
      },
      reportError(message) {
        reports.push(message);
      },
    },
  };
};

test("registerはaction handlerを自身のfeature idで登録する", () => {
  const state = createCaptureState({
    coordinator: pendingCoordinator,
    async submitDraft() {
      throw new Error("unreachable");
    },
  });
  const h = harness();
  const worker = createCaptureWorkerRegistration({ state });

  const result = worker.register(h.context);

  assert.equal(result.ok, true);
  assert.ok(h.handlers.has(productCaptureFeatureId));
});

test("登録したaction handlerを呼び出すとcaptureCurrentTabが実行される", async () => {
  let calls = 0;
  const coordinator: CaptureCoordinator = {
    async captureCurrentTab() {
      calls += 1;
      return new Promise(() => {});
    },
  };
  const state = createCaptureState({
    coordinator,
    async submitDraft() {
      throw new Error("unreachable");
    },
  });
  const h = harness();
  const worker = createCaptureWorkerRegistration({ state });
  const result = worker.register(h.context);
  assert.equal(result.ok, true);

  const handler = h.handlers.get(productCaptureFeatureId);
  assert.ok(handler);
  // The handler awaits `captureCurrentTab`, which never resolves here, so it
  // must not be awaited to completion; only its synchronous prefix matters.
  void handler();

  assert.equal(calls, 1);
  assert.equal(state.value.status, "extracting");
});

test("action以外の経路からは抽出が走らない", () => {
  const state = createCaptureState({
    coordinator: pendingCoordinator,
    async submitDraft() {
      throw new Error("unreachable");
    },
  });
  createCaptureWorkerRegistration({ state });

  assert.deepEqual(state.value, { status: "idle" });
});

test("cleanupを呼ぶとaction handlerの登録が解除される", () => {
  const state = createCaptureState({
    coordinator: pendingCoordinator,
    async submitDraft() {
      throw new Error("unreachable");
    },
  });
  const h = harness();
  const worker = createCaptureWorkerRegistration({ state });
  const result = worker.register(h.context);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  result.value();

  assert.equal(h.handlers.has(productCaptureFeatureId), false);
});

test("registerが例外を投げるcontextに対してもinvalid_registrationを返す", () => {
  const state = createCaptureState({
    coordinator: pendingCoordinator,
    async submitDraft() {
      throw new Error("unreachable");
    },
  });
  const worker = createCaptureWorkerRegistration({ state });
  const throwingContext: WorkerRegistrationContext = {
    addActionHandler() {
      throw new Error("unexpected");
    },
    reportError() {},
  };

  const result = worker.register(throwingContext);

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.kind, "invalid_registration");
});

test("shellのworker合成(composeWorkerRegistrations)を通じて登録・解除できる", () => {
  const state = createCaptureState({
    coordinator: pendingCoordinator,
    async submitDraft() {
      throw new Error("unreachable");
    },
  });
  const h = harness();
  const worker = createCaptureWorkerRegistration({ state });

  const composed = composeWorkerRegistrations([worker], h.context);

  assert.equal(composed.ok, true);
  assert.ok(h.handlers.has(productCaptureFeatureId));
  if (!composed.ok) return;
  composed.value();
  assert.equal(h.handlers.has(productCaptureFeatureId), false);
});
