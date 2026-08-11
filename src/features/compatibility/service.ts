import { err, ok, type ProjectId, type Result } from "../../domain/public.js";
import type {
  CandidateQuery,
  ManagementError,
} from "../candidate-management/public.js";
import type { BuildError, CurrentBuildQuery } from "../current-build/public.js";
import { resultAggregator } from "./aggregator.js";
import type {
  CompatibilityError,
  CompatibilityQuery,
  CompatibilityReport,
  RuleResult,
} from "./contracts.js";
import { RULE_REGISTRY } from "./rules.js";
import { targetExpander } from "./target-expander.js";

export interface CompatibilityServiceDependencies {
  readonly currentBuildQuery: CurrentBuildQuery;
  readonly candidateQuery: CandidateQuery;
}

const buildErrorToCompatibilityError = (
  error: BuildError,
): CompatibilityError => {
  switch (error.kind) {
    case "corrupt-data":
      return { kind: "corrupt-data" };
    case "unsupported-data":
      return { kind: "unsupported-data" };
    default:
      return { kind: "read-failed" };
  }
};

const managementErrorToCompatibilityError = (
  error: ManagementError,
): CompatibilityError => {
  switch (error.kind) {
    case "unsupported-data":
      return { kind: "unsupported-data" };
    default:
      return { kind: "read-failed" };
  }
};

const ruleById = new Map(RULE_REGISTRY.map((rule) => [rule.id, rule]));

/**
 * Reads current-build-management and candidate-management by projectId,
 * validates references, then runs expansion → rule evaluation → aggregation.
 * Never persists; every call re-reads upstream so results never go stale.
 */
export const createCompatibilityService = (
  dependencies: CompatibilityServiceDependencies,
): CompatibilityQuery => ({
  async evaluate(
    projectId: ProjectId,
  ): Promise<Result<CompatibilityReport, CompatibilityError>> {
    const buildResult =
      await dependencies.currentBuildQuery.getByProject(projectId);
    if (!buildResult.ok) {
      return err(buildErrorToCompatibilityError(buildResult.error));
    }

    const snapshot = buildResult.value;
    const currentBuild = snapshot.currentBuild;
    if (currentBuild === null) {
      return err({ kind: "no-build" });
    }
    if (currentBuild.items.length === 0) {
      return err({ kind: "empty-build" });
    }

    const candidatesResult =
      await dependencies.candidateQuery.listBuildEligible(projectId);
    if (!candidatesResult.ok) {
      return err(managementErrorToCompatibilityError(candidatesResult.error));
    }

    const targetsResult = targetExpander.expand(
      snapshot,
      candidatesResult.value,
    );
    if (!targetsResult.ok) {
      return targetsResult;
    }

    const results: RuleResult[] = targetsResult.value.map((target) => {
      const rule = ruleById.get(target.ruleId);
      if (rule === undefined) {
        throw new Error(
          `no compatibility rule registered for ${target.ruleId}`,
        );
      }
      return rule.evaluate(target);
    });

    return ok({
      projectId,
      buildUpdatedAt: currentBuild.updatedAt,
      status: resultAggregator.aggregate(results),
      results,
    });
  },
});
