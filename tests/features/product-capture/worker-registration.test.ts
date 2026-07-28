import assert from "node:assert/strict";
import test from "node:test";
import type { FeatureCompositionContext } from "../../../src/application-shell/public.js";
import { createProductCaptureContribution } from "../../../src/features/product-capture/feature-contribution.js";

test("transient capture contributionは旧action worker registrationを申告しない", () => {
  const contribution = createProductCaptureContribution(
    {} as FeatureCompositionContext,
    {
      runtime: {
        async getTab() {
          return { ok: false, error: { kind: "tab-unavailable" } };
        },
        async inject() {
          return { ok: false, error: "unknown" };
        },
      },
      transientSurface: {
        isCurrent: () => false,
        async conclude() {
          return { ok: false, error: { kind: "not-started" } };
        },
      },
      createCandidateEditorIntent: (() => ({
        featureId: "candidate-management",
        target: "edit",
        payload: {},
      })) as never,
    },
  );
  assert.equal("workerRegistration" in contribution, false);
});
