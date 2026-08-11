import assert from "node:assert/strict";
import test from "node:test";

import type { FeatureCompositionContext } from "../../../src/application-shell/public.js";
import type { CandidateQuery } from "../../../src/features/candidate-management/public.js";
import { createCurrentBuildContribution } from "../../../src/features/current-build/feature-contribution.js";

test("project-context public portがないcompositionは候補一覧へfallbackしない", async () => {
  let projectQueries = 0;
  const candidates: CandidateQuery = {
    async listProjects() {
      projectQueries += 1;
      return { ok: true, value: [] };
    },
    async listCandidates() {
      return { ok: true, value: [] };
    },
    async listBuildEligible() {
      return { ok: true, value: [] };
    },
    async getCandidateDraft() {
      throw new Error("not used");
    },
  };
  const contribution = createCurrentBuildContribution(
    {
      data: {} as FeatureCompositionContext["data"],
      navigator: {} as FeatureCompositionContext["navigator"],
    },
    { candidates },
  );

  const handle = await contribution.registration.mount({
    container: document.createElement("div"),
    operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
    reportError: () => {},
  });

  assert.equal(projectQueries, 0);
  await handle.unmount();
});
