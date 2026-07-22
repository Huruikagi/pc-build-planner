import type { CurrentBuildQuery } from "./contracts.js";

export type {
  BuildCommand,
  BuildError,
  BuildMutationContext,
  BuildService,
  CurrentBuildQuery,
  CurrentBuildSnapshot,
} from "./contracts.js";

/** Read-only downstream contract: canonical candidate references and quantities only. */
export interface CurrentBuildPublicApi {
  readonly query: CurrentBuildQuery;
}

export interface CurrentBuildPublicDependencies {
  readonly query: CurrentBuildQuery;
}

export const createCurrentBuildPublicApi = (
  dependencies: CurrentBuildPublicDependencies,
): CurrentBuildPublicApi => {
  if (dependencies.query === undefined) {
    throw new TypeError(
      "Current build public API requires a query dependency.",
    );
  }
  return Object.freeze({
    query: dependencies.query,
  });
};
