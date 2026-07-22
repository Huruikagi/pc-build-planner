import type {
  CandidatePart,
  CandidatePartId,
  CurrentBuild,
  ProjectId,
  Result,
} from "../../domain/public.js";
import type { FoundationScopedDataPort } from "../../persistence/public.js";
import { type CategoryPolicy, isValidQuantity } from "./category-policy.js";
import type { BuildError, CurrentBuildQuery } from "./contracts.js";

export interface CurrentBuildQueryDependencies {
  readonly data: FoundationScopedDataPort;
  readonly policy: CategoryPolicy;
}

const corruptData: BuildError = { kind: "corrupt-data" };

const foundationErrorToBuildError = (code: string): BuildError => {
  switch (code) {
    case "quota-exceeded":
      return { kind: "quota" };
    case "unsupported-version":
    case "migration-failed":
      return { kind: "unsupported-data" };
    case "access-denied":
    case "lock-unavailable":
    case "storage-unavailable":
      return { kind: "storage" };
    case "maintenance-active":
    case "stale-fence":
      return { kind: "maintenance" };
    default:
      return corruptData;
  }
};

/**
 * Verifies the feature invariants a Foundation query cannot enforce on its
 * own: at most one build item per candidate, only same-project classified
 * candidates, and quantities matching the candidate's category selection mode.
 */
const validateBuild = (
  build: CurrentBuild,
  candidates: readonly CandidatePart[],
  policy: CategoryPolicy,
): Result<true, BuildError> => {
  const candidateById = new Map(
    candidates.map((candidate) => [candidate.id, candidate]),
  );
  const seenCandidateIds = new Set<CandidatePartId>();
  const singleCategorySeen = new Set<string>();

  for (const item of build.items) {
    if (seenCandidateIds.has(item.candidatePartId)) {
      return { ok: false, error: corruptData };
    }
    seenCandidateIds.add(item.candidatePartId);

    const candidate = candidateById.get(item.candidatePartId);
    if (candidate === undefined) {
      return { ok: false, error: corruptData };
    }

    const mode = policy.modeFor(candidate.category);
    if (mode === "ineligible" || !isValidQuantity(mode, item.quantity)) {
      return { ok: false, error: corruptData };
    }

    if (mode === "single") {
      if (singleCategorySeen.has(candidate.category)) {
        return { ok: false, error: corruptData };
      }
      singleCategorySeen.add(candidate.category);
    }
  }

  return { ok: true, value: true };
};

export const createCurrentBuildQuery = (
  dependencies: CurrentBuildQueryDependencies,
): CurrentBuildQuery => ({
  async getByProject(projectId: ProjectId) {
    const result = await dependencies.data.query((root) => ({
      revision: root.revision,
      builds: root.currentBuilds.filter(
        (build) => build.projectId === projectId,
      ),
      candidates: root.candidateParts.filter(
        (candidate) => candidate.projectId === projectId,
      ),
    }));
    if (!result.ok) {
      return {
        ok: false,
        error: foundationErrorToBuildError(result.error.code),
      };
    }

    const { revision, builds, candidates } = result.value;
    if (builds.length > 1) {
      return { ok: false, error: corruptData };
    }

    const build = builds[0];
    if (build === undefined) {
      return { ok: true, value: { revision, currentBuild: null } };
    }

    const validated = validateBuild(build, candidates, dependencies.policy);
    if (!validated.ok) {
      return validated;
    }

    return { ok: true, value: { revision, currentBuild: build } };
  },
});
