import assert from "node:assert/strict";
import test from "node:test";
import type {
  ActivationId,
  FeatureActivationIntent,
  FeatureId,
  TargetTabId,
} from "../../../src/application-shell/public.js";
import { ok } from "../../../src/domain/public.js";
import {
  type CaptureTimeoutScheduler,
  createChromeCaptureRuntimePort,
} from "../../../src/features/product-capture/chrome-runtime-port.js";
import { createCaptureCoordinator } from "../../../src/features/product-capture/coordinator.js";
import type { CandidateEditorHandoff } from "../../../src/features/product-capture/editor-handoff.js";
import { createCaptureNormalizer } from "../../../src/features/product-capture/normalizer.js";
import { createCandidateRanker } from "../../../src/features/product-capture/ranker.js";
import { createCaptureState } from "../../../src/features/product-capture/state.js";

const A = "activation-a" as ActivationId;
const B = "activation-b" as ActivationId;
const TAB = 7 as TargetTabId;
const PAGE_URL = "https://example.invalid/p";
const intent: FeatureActivationIntent = {
  featureId: "candidate-management" as FeatureId,
  target: "open-candidate-editor",
  payload: {},
};

const pageResult = [
  {
    result: {
      pageUrl: PAGE_URL,
      candidates: [
        {
          field: "name",
          rawValue: "架空ケース",
          source: "json-ld",
          sourceLabel: "name",
          documentOrder: 0,
        },
      ],
    },
  },
];

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Fires page-side budgets on demand so both unresponsive stages stay deterministic. */
const manualScheduler = (): CaptureTimeoutScheduler & {
  fire(): void;
  readonly waiting: number;
} => {
  const waiting: Array<() => void> = [];
  return {
    schedule(onTimeout) {
      waiting.push(onTimeout);
      return () => {
        const index = waiting.indexOf(onTimeout);
        if (index >= 0) waiting.splice(index, 1);
      };
    },
    fire() {
      const next = waiting.shift();
      assert.ok(next, "expected a pending page-side timeout");
      next();
    },
    get waiting() {
      return waiting.length;
    },
  };
};

/**
 * Wires the real Chrome runtime port, coordinator and capture state so an
 * unresponsive page is observed exactly as the surface observes it.
 */
const harness = (unresponsiveCall: 1 | 2) => {
  const scheduler = manualScheduler();
  const concluded: Array<[ActivationId, FeatureActivationIntent]> = [];
  let calls = 0;
  let unresponsive = true;
  const runtime = createChromeCaptureRuntimePort({
    tabs: {
      async get(id) {
        return { id, url: PAGE_URL };
      },
    },
    scripting: {
      async executeScript(details) {
        calls += 1;
        if (unresponsive && calls === unresponsiveCall)
          return new Promise<never>(() => {});
        return details.files ? [{}] : pageResult;
      },
    },
    injectionTimeoutMs: 5_000,
    timeoutScheduler: scheduler,
  });
  const handoff: CandidateEditorHandoff = {
    prepare: () => ok(intent),
    prepareManual: () => intent,
    async conclude(activationId, value) {
      concluded.push([activationId, value]);
      return ok(undefined);
    },
    retry: async () => ok(undefined),
  };
  let current: ActivationId = A;
  const state = createCaptureState({
    coordinator: createCaptureCoordinator({
      runtime,
      normalizer: createCaptureNormalizer(),
      ranker: createCandidateRanker(),
    }),
    isCurrent: (activationId) => activationId === current,
    handoff,
    dismissFatal: async () => ok(undefined),
  });
  return {
    state,
    scheduler,
    concluded,
    respond() {
      unresponsive = false;
      calls = 0;
    },
    replaceGeneration(next: ActivationId) {
      current = next;
      state.activate(next, TAB);
    },
  };
};

for (const [label, unresponsiveCall] of [
  ["注入", 1],
  ["結果読取り", 2],
] as const) {
  test(`${label}段階の未応答は失敗表示になり同世代の再試行で回復する`, async () => {
    const { state, scheduler, concluded, respond } = harness(unresponsiveCall);
    state.activate(A, TAB);

    const first = state.startCapture();
    await flush();
    const during = state.value;
    assert.equal(during?.status, "extracting");
    scheduler.fire();
    await first;

    assert.deepEqual(
      state.value?.status === "failed" ? state.value.failure : null,
      {
        kind: "execution",
        error: { kind: "injection-failed" },
        recoverable: true,
      },
    );
    assert.deepEqual(concluded, []);
    // The same activation stays addressable, so retry needs no new gesture.
    assert.equal(state.value?.activationId, A);

    respond();
    await state.startCapture();
    assert.deepEqual(concluded, [[A, intent]]);
    assert.equal(state.value, null);
    assert.equal(scheduler.waiting, 0);
  });
}

test("timeout後に応答したページ結果は後発activationへ適用されない", async () => {
  const { state, scheduler, concluded, replaceGeneration } = harness(1);
  state.activate(A, TAB);

  const stale = state.startCapture();
  await flush();
  scheduler.fire();
  replaceGeneration(B);
  await stale;

  assert.deepEqual(concluded, []);
  assert.deepEqual(state.value, {
    status: "idle",
    activationId: B,
    tabId: TAB,
  });
});
