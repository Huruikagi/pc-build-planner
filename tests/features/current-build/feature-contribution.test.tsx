import assert from "node:assert/strict";
import test from "node:test";

import type { FeatureCompositionContext } from "../../../src/application-shell/public.js";
import type { CandidateQuery } from "../../../src/features/candidate-management/public.js";
import {
  type CurrentBuildContributionDependencies,
  createCurrentBuildContribution,
} from "../../../src/features/current-build/feature-contribution.js";

type Assert<T extends true> = T;
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <
    Value,
  >() => Value extends Right ? 1 : 2
    ? true
    : false;

type _CandidateDependencyKeysAreBuildEligibleOnly = Assert<
  Equal<
    keyof CurrentBuildContributionDependencies["candidates"],
    "listBuildEligible"
  >
>;

test("project-context public portがないcompositionは候補一覧へfallbackしない", async () => {
  const candidates: Pick<CandidateQuery, "listBuildEligible"> = {
    async listBuildEligible() {
      return { ok: true, value: [] };
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

  assert.equal(contribution.key, "currentBuild");
  await handle.unmount();
});
