import type { CompatibilityQuery } from "./contracts.js";

export type {
  AggregateStatus,
  CompatibilityError,
  CompatibilityQuery,
  CompatibilityReport,
  RuleId,
  RuleResult,
} from "./contracts.js";

/** Read-only downstream contract: the aggregate report query only. */
export interface CompatibilityPublicApi {
  readonly query: CompatibilityQuery;
}

export interface CompatibilityPublicDependencies {
  readonly query: CompatibilityQuery;
}

export const createCompatibilityPublicApi = (
  dependencies: CompatibilityPublicDependencies,
): CompatibilityPublicApi => {
  if (dependencies.query === undefined) {
    throw new TypeError(
      "Compatibility public API requires a query dependency.",
    );
  }
  return Object.freeze({
    query: dependencies.query,
  });
};
