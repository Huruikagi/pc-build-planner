import assert from "node:assert/strict";
import test from "node:test";
import type {
  FeatureCompositionContext,
  TargetTabId,
} from "../../../src/application-shell/public.js";
import { createProductCaptureContribution } from "../../../src/features/product-capture/feature-contribution.js";

test("contributionはtransient registrationを公開しworkerを登録しない", () => {
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
        isCurrent: () => true,
        async conclude() {
          return { ok: true, value: undefined };
        },
      },
      createCandidateEditorIntent: (() => ({
        featureId: "candidate-management",
        target: "edit",
        payload: {},
      })) as never,
    },
  );
  assert.equal(contribution.registration.presentation, "transient");
  assert.equal(contribution.workerRegistration, undefined);
  void (7 as TargetTabId);
});
