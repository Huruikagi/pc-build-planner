import type {
  FeatureCompositionContext,
  FeatureContribution,
} from "../../application-shell/public.js";
import { createUuid, type RequestId } from "../../domain/public.js";
import type { ProductIdentityNormalizer } from "../product-capture/public.js";
import type { SourcePriceRefreshPort } from "../source-price-refresh/public.js";
import type {
  CandidateSourceMutationPort,
  MutationContext,
} from "./contracts.js";
import { createDuplicateCandidateMatcher } from "./duplicate-matcher.js";
import { createDuplicateMergeCoordinator } from "./duplicate-merge.js";
import { createDuplicateUrlRouter } from "./duplicate-url-router.js";
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

export { createCandidateSourceDataPort } from "./source-data-port.js";
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
  readonly identityNormalizer?: ProductIdentityNormalizer;
  readonly sourcePriceRefresh?: SourcePriceRefreshPort;
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
    ...(dependencies.sourceData === undefined
      ? {}
      : { sourceData: dependencies.sourceData }),
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

  const sourceMutations: CandidateSourceMutationPort = {
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
    async patchSourcePrice(input) {
      const result = await service.patchSourcePrice(
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
  };
  const duplicateMergeCoordinator =
    dependencies.identityNormalizer === undefined ||
    dependencies.sourcePriceRefresh === undefined
      ? undefined
      : createDuplicateMergeCoordinator({
          query: service,
          matcher: createDuplicateCandidateMatcher(
            dependencies.identityNormalizer,
          ),
          router: createDuplicateUrlRouter({
            refresh: dependencies.sourcePriceRefresh,
            sourceMutations,
          }),
          createCandidate: service.createCandidate.bind(service),
        });

  const state = createManagementState({
    query: service,
    service,
    createMutationContext,
    ...(dependencies.sourcePage === undefined
      ? {}
      : { sourcePage: dependencies.sourcePage }),
    ...(duplicateMergeCoordinator === undefined
      ? {}
      : { duplicateMergeCoordinator }),
  });

  const registration = createCandidateFeatureRegistration({
    data: context.data,
    query: service,
    publicQuery: service,
    sources: {
      catalog,
      mutations: sourceMutations,
    },
    state,
  });

  return {
    key: candidateManagementContributionKey,
    registration,
  };
};
