import type {
  FeatureCompositionContext,
  FeatureContribution,
} from "../../application-shell/public.js";
import { createUuid, type RequestId } from "../../domain/public.js";
import type { MutationContext } from "./contracts.js";
import type { CandidateManagementPublicApi } from "./public.js";
import { createCandidateFeatureRegistration } from "./registration.js";
import { createCandidateManagementService } from "./service.js";
import { createCandidateSourceCatalog } from "./source-catalog.js";
import {
  type CandidateSourceDataPort,
  unavailableCandidateSourceDataPort,
} from "./source-data-port.js";
import type { SourceKindClassifier } from "./source-kind-classifier.js";
import type { SourcePagePort } from "./source-page-port.js";
import { createManagementState } from "./state.js";

export {
  createSourceKindClassifier,
  type SourceKindClassifier,
} from "./source-kind-classifier.js";
export {
  createChromeSourcePagePort,
  type SourcePagePort,
  type TabsCreatePort,
} from "./source-page-port.js";

export const candidateManagementContributionKey = "candidateManagement";

export type CandidateManagementContribution = FeatureContribution<
  typeof candidateManagementContributionKey,
  CandidateManagementPublicApi
>;

export interface CandidateManagementContributionDependencies {
  readonly sourceData?: CandidateSourceDataPort;
  readonly classifier?: SourceKindClassifier;
  readonly sourcePage?: SourcePagePort;
}

/**
 * Assembles the feature from the shell-provided composition context only.
 * Persistence is reached exclusively through the injected scoped data port.
 */
export const createCandidateManagementContribution = (
  context: FeatureCompositionContext,
  input:
    | CandidateManagementContributionDependencies
    | CandidateSourceDataPort = {},
): CandidateManagementContribution => {
  const dependencies: CandidateManagementContributionDependencies =
    "query" in input ? { sourceData: input } : input;
  const sourceData =
    dependencies.sourceData ?? unavailableCandidateSourceDataPort;
  const service = createCandidateManagementService({
    data: context.data,
    sourceData,
    ...(dependencies.classifier === undefined
      ? {}
      : { classifier: dependencies.classifier }),
  });
  const catalog = createCandidateSourceCatalog({ data: sourceData });

  /**
   * The expected revision is read per mutation, so a concurrent writer in
   * another MV3 context surfaces as a typed conflict instead of a lost update.
   */
  const createMutationContext = async (): Promise<MutationContext> => {
    const revision = await context.data.query((root) => root.revision);
    return {
      requestId: createUuid() as RequestId,
      expectedRevision: revision.ok ? revision.value : 0,
    };
  };
  const createSourceMutationContext = async (): Promise<MutationContext> => {
    const revision = await sourceData.query((root) => root.revision);
    return {
      requestId: createUuid() as RequestId,
      expectedRevision: revision.ok ? revision.value : 0,
    };
  };

  const state = createManagementState({
    query: service,
    service,
    createMutationContext,
    ...(dependencies.sourcePage === undefined
      ? {}
      : { sourcePage: dependencies.sourcePage }),
  });

  const registration = createCandidateFeatureRegistration({
    data: context.data,
    query: service,
    sources: {
      catalog,
      mutations: {
        async addSource(input) {
          const result = await service.addSource(
            input,
            await createSourceMutationContext(),
          );
          return result.ok ? { ok: true, value: undefined } : result;
        },
        async updateSource(input) {
          const result = await service.updateSource(
            input,
            await createSourceMutationContext(),
          );
          return result.ok ? { ok: true, value: undefined } : result;
        },
        async removeSource(input) {
          const result = await service.removeSource(
            input,
            await createSourceMutationContext(),
          );
          return result.ok ? { ok: true, value: undefined } : result;
        },
        async setPrimarySource(input) {
          const result = await service.setPrimarySource(
            input,
            await createSourceMutationContext(),
          );
          return result.ok ? { ok: true, value: undefined } : result;
        },
      },
    },
    state,
  });

  return {
    key: candidateManagementContributionKey,
    registration,
  };
};
