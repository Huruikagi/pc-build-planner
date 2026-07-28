import type {
  FeatureActivationError,
  FeatureActivationIntent,
  ShellNavigator,
} from "../../application-shell/public.js";
import { err } from "../../domain/public.js";
import type { FoundationScopedDataPort } from "../../persistence/public.js";
import {
  type CandidateEditorPrefill,
  createCandidateEditorIntent,
} from "./activation.js";
import type {
  CandidateQuery,
  CandidateSourceCatalogPort,
  CandidateSourceMutationPort,
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
    prefill: CandidateEditorPrefill,
  ): FeatureActivationIntent;
  openCandidateEditor(
    prefill: CandidateEditorPrefill,
  ): Promise<
    import("../../domain/public.js").Result<void, FeatureActivationError>
  >;
}

export interface CandidateManagementPublicDependencies {
  readonly data: FoundationScopedDataPort;
  readonly query: CandidateQuery;
  readonly sources: {
    readonly catalog: CandidateSourceCatalogPort;
    readonly mutations: CandidateSourceMutationPort;
  };
  readonly navigator?: ShellNavigator;
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
    openCandidateEditor(prefill: CandidateEditorPrefill) {
      if (dependencies.navigator === undefined) {
        return Promise.resolve(
          err<FeatureActivationError>({
            kind: "invalid_activation",
            detail: "navigator unavailable",
          }),
        );
      }
      return dependencies.navigator.activate(
        this.createCandidateEditorIntent(prefill),
      );
    },
  });
};

export type { CandidateEditorPrefill } from "./activation.js";
