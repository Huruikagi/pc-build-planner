import type { AggregateStatus, RuleResult } from "./contracts.js";

export interface ResultAggregator {
  aggregate(results: readonly RuleResult[]): AggregateStatus;
}

/**
 * Priority: any incompatible wins outright; otherwise a compatible/unknown mix
 * is caution; all compatible is compatible; everything else (all unknown, or
 * no evaluable results at all) is unknown.
 */
export const resultAggregator: ResultAggregator = {
  aggregate(results) {
    if (results.some((result) => result.status === "incompatible")) {
      return "incompatible";
    }

    const hasCompatible = results.some(
      (result) => result.status === "compatible",
    );
    const hasUnknown = results.some((result) => result.status === "unknown");

    if (hasCompatible && hasUnknown) {
      return "caution";
    }
    if (hasCompatible) {
      return "compatible";
    }
    return "unknown";
  },
};
