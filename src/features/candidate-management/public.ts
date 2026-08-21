import type { FeatureActivationIntent } from "../../application-shell/public.js";
import { createCandidateEditorIntent } from "./activation.js";
import type {
  CandidateCreatePort,
  CandidateQuery,
  CandidateSourceCatalogPort,
  CandidateSourceMutationPort,
  UnresolvedCandidateEditorPrefill,
} from "./contracts.js";

export type {
  AddCandidateSourceInput,
  CandidateCreatePort,
  CandidateDraft,
  CandidateListQuery,
  CandidateOperationError,
  CandidateQuery,
  CandidateSourceCatalogPort,
  CandidateSourceMutationError,
  CandidateSourceMutationPort,
  CandidateSourceReference,
  CandidateSummary,
  CandidateValidationError,
  MutationContext,
  PatchCandidateSourcePriceInput,
  ProjectSummary,
  RemoveCandidateSourceInput,
  SetPrimarySourceInput,
  UpdateCandidateInput,
  UpdateCandidateSourceInput,
} from "./contracts.js";

/** Feature-local public boundary for downstream candidate-management contracts. */
export interface CandidateManagementPublicApi {
  readonly query: CandidateQuery;
  readonly create: CandidateCreatePort;
  readonly sources: {
    readonly catalog: CandidateSourceCatalogPort;
    readonly mutations: CandidateSourceMutationPort;
  };
  createCandidateEditorIntent(
    prefill: UnresolvedCandidateEditorPrefill,
  ): FeatureActivationIntent;
}

export interface CandidateManagementPublicDependencies {
  readonly query: CandidateQuery;
  readonly create: CandidateCreatePort;
  readonly sources: {
    readonly catalog: CandidateSourceCatalogPort;
    readonly mutations: CandidateSourceMutationPort;
  };
}

export const createCandidateManagementPublicApi = (
  dependencies: CandidateManagementPublicDependencies,
): CandidateManagementPublicApi => {
  const query = dependencies.query;
  const create = dependencies.create;
  const catalog = dependencies.sources?.catalog;
  const mutations = dependencies.sources?.mutations;
  if (
    typeof query?.listProjects !== "function" ||
    typeof query.listCandidates !== "function" ||
    typeof query.listBuildEligible !== "function" ||
    typeof query.getCandidateDraft !== "function" ||
    typeof create?.createCandidate !== "function" ||
    typeof catalog?.listSourceReferences !== "function" ||
    typeof catalog.getSourceReference !== "function" ||
    typeof mutations?.addSource !== "function" ||
    typeof mutations.updateSource !== "function" ||
    typeof mutations.patchSourcePrice !== "function" ||
    typeof mutations.removeSource !== "function" ||
    typeof mutations.setPrimarySource !== "function"
  ) {
    throw new TypeError(
      "Candidate management public API requires query, create, and sources dependencies.",
    );
  }
  return Object.freeze({
    query: dependencies.query,
    create: dependencies.create,
    sources: Object.freeze({
      catalog: dependencies.sources.catalog,
      mutations: dependencies.sources.mutations,
    }),
    createCandidateEditorIntent,
  });
};

export type { UnresolvedCandidateEditorPrefill as CandidateEditorPrefill } from "./contracts.js";
