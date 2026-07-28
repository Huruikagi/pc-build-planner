import type { FeatureActivationIntent } from "../../application-shell/public.js";
import { createCandidateEditorIntent } from "./activation.js";
import type {
  CandidateQuery,
  CandidateSourceCatalogPort,
  CandidateSourceMutationPort,
  UnresolvedCandidateEditorPrefill,
} from "./contracts.js";

export type {
  AddCandidateSourceInput,
  CandidateListQuery,
  CandidateQuery,
  CandidateSourceCatalogPort,
  CandidateSourceDraft as CandidateDraft,
  CandidateSourceMutationPort,
  CandidateSourceReference,
  CandidateSummary,
  CreateProjectInput,
  ManagementError,
  MutationContext,
  ProjectSummary,
  RemoveCandidateSourceInput,
  RenameProjectInput,
  SetPrimarySourceInput,
  UpdateCandidateInput,
  UpdateCandidateSourceInput,
} from "./contracts.js";

/** Feature-local public boundary for downstream candidate-management contracts. */
export interface CandidateManagementPublicApi {
  readonly query: CandidateQuery;
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
  readonly sources: {
    readonly catalog: CandidateSourceCatalogPort;
    readonly mutations: CandidateSourceMutationPort;
  };
}

export const createCandidateManagementPublicApi = (
  dependencies: CandidateManagementPublicDependencies,
): CandidateManagementPublicApi => {
  if (
    dependencies.query === undefined ||
    dependencies.sources?.catalog === undefined ||
    dependencies.sources.mutations === undefined
  ) {
    throw new TypeError(
      "Candidate management public API requires query and sources dependencies.",
    );
  }
  return Object.freeze({
    query: dependencies.query,
    sources: Object.freeze({
      catalog: dependencies.sources.catalog,
      mutations: dependencies.sources.mutations,
    }),
    createCandidateEditorIntent,
  });
};

export type { UnresolvedCandidateEditorPrefill as CandidateEditorPrefill } from "./contracts.js";
