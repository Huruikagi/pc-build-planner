import type {
  FeatureCompositionContext,
  FeatureContribution,
} from "../../application-shell/public.js";
import type {
  CandidateSourceCatalogPort as CanonicalCandidateSourceCatalogPort,
  CandidateSourceMutationPort as CanonicalCandidateSourceMutationPort,
} from "../../candidate-sources/public.js";
import { createUuid, type RequestId } from "../../domain/public.js";
import type { ProductIdentityNormalizer } from "../product-capture/public.js";
import type { SourcePriceRefreshPort } from "../source-price-refresh/public.js";
import type {
  CandidateSourceMutationPort,
  CurrentProjectPort,
  MutationContext,
} from "./contracts.js";
import { createDuplicateCandidateMatcher } from "./duplicate-matcher.js";
import { createDuplicateMergeCoordinator } from "./duplicate-merge.js";
import { createDuplicateUrlRouter } from "./duplicate-url-router.js";
import { createProjectContextAdapter } from "./project-context-adapter.js";
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
  readonly sourceEditor?: {
    readonly catalog: CanonicalCandidateSourceCatalogPort;
    readonly mutations: CanonicalCandidateSourceMutationPort;
  };
  readonly sourceData?: CandidateSourceDataPort;
  readonly classifier?: SourceKindClassifier;
  readonly sourcePage?: SourcePagePort;
  readonly identityNormalizer?: ProductIdentityNormalizer;
  readonly sourcePriceRefresh?: SourcePriceRefreshPort;
  readonly projectContext?: {
    readonly commands: Pick<
      import("../../project-context/public.js").ProjectContextCommandPort,
      "refresh"
    >;
    readonly guards?: import("../../project-context/public.js").ProjectContextChangeGuardRegistrationPort;
    /** Host-neutral lifecycle UI assembled by the canonical project-context owner. */
    readonly lifecyclePresentation?: import("../../project-context/public.js").ProjectLifecyclePresentationContribution;
  };
}

/**
 * Projects the shell-provided context onto the feature's save-target port.
 * Only a `ready` context yields a project; `empty` and `unavailable` stay
 * unresolved so no catalog entry is promoted into a save target.
 */
const createCurrentProjectPort = (
  read: FeatureCompositionContext["projectContext"],
): CurrentProjectPort => ({
  getCurrentProject() {
    const snapshot = read?.getSnapshot();
    return snapshot?.status === "ready"
      ? { status: "resolved", projectId: snapshot.selectedProjectId }
      : { status: "unresolved" };
  },
  subscribe(listener) {
    return read?.subscribe(() => listener()) ?? (() => {});
  },
});

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

  let state: ReturnType<typeof createManagementState> | undefined;
  const projectContextAdapter =
    context.projectContext === undefined ||
    dependencies.projectContext === undefined
      ? undefined
      : createProjectContextAdapter({
          read: context.projectContext,
          commands: dependencies.projectContext.commands,
          ...(dependencies.projectContext.guards === undefined
            ? {}
            : { guards: dependencies.projectContext.guards }),
          draftGuard: {
            isDirty: () => state?.hasDirtyProjectDraft() ?? false,
            discardConfirmedSwitch: (from, to) =>
              state?.discardDraftForConfirmedSwitch(from, to),
            preserveForcedSwitch: (from) =>
              state?.preserveDraftAfterForcedSwitch(from),
          },
        });
  state = createManagementState({
    query: service,
    service,
    createMutationContext,
    currentProject:
      projectContextAdapter ?? createCurrentProjectPort(context.projectContext),
    ...(dependencies.sourcePage === undefined
      ? {}
      : { sourcePage: dependencies.sourcePage }),
    ...(dependencies.sourceEditor === undefined
      ? {}
      : { sourceEditor: dependencies.sourceEditor }),
    ...(duplicateMergeCoordinator === undefined
      ? {}
      : { duplicateMergeCoordinator }),
  });

  const registration = createCandidateFeatureRegistration({
    data: context.data,
    query: service,
    create: {
      createCandidate: (draft, mutationContext) =>
        service.createCandidate(draft, mutationContext),
    },
    publicQuery: service,
    sources: {
      catalog,
      mutations: sourceMutations,
    },
    state,
    ...(projectContextAdapter === undefined
      ? {}
      : { lifecycle: projectContextAdapter }),
    ...(dependencies.projectContext?.lifecyclePresentation === undefined
      ? {}
      : {
          projectLifecyclePresentation:
            dependencies.projectContext.lifecyclePresentation,
        }),
  });

  return {
    key: candidateManagementContributionKey,
    registration,
  };
};
