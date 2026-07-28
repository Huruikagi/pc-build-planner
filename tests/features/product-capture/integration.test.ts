import assert from "node:assert/strict";
import test from "node:test";
import type {
  FeatureCompositionContext,
  TargetTabId,
} from "../../../src/application-shell/public.js";
import { createProductCaptureContribution } from "../../../src/features/product-capture/feature-contribution.js";

test("contributionはtransient registrationと同じruntime由来の価格portを一度だけ公開する", async () => {
  let tabLookups = 0;
  const runtime = {
    async getTab() {
      tabLookups += 1;
      return {
        ok: false as const,
        error: { kind: "tab-unavailable" as const },
      };
    },
    async inject() {
      return { ok: false as const, error: "unknown" as const };
    },
  };
  const contribution = createProductCaptureContribution(
    {} as FeatureCompositionContext,
    {
      runtime,
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
  const publicPort = contribution.registration.publicApi.pagePriceExtraction;
  assert.equal(
    contribution.registration.publicApi.pagePriceExtraction,
    publicPort,
  );
  assert.deepEqual(await publicPort.extractPrice(7 as TargetTabId), {
    ok: false,
    error: { kind: "tab-unavailable" },
  });
  assert.equal(tabLookups, 1);
});
