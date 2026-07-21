import type {
  ApplicationFeatureRegistration,
  Availability,
  FeatureId,
  FeatureMountContext,
  FeatureMountHandle,
  OperationPolicy,
} from "../../application-shell/public.js";
import type { FoundationDataPort } from "../../persistence/public.js";
import {
  createCandidateManagementPublicApi,
  type CandidateManagementPublicApi,
} from "./public.js";

const candidateManagementFeatureId = "candidate-management" as FeatureId;

export interface CandidateManagementMountDependencies {
  readonly container: HTMLElement;
  readonly data: FoundationDataPort;
  readonly operationPolicy: OperationPolicy;
  readonly reportError: (message: string) => void;
  readonly restoredState?: unknown;
}

export type CandidateManagementMount = (
  dependencies: CandidateManagementMountDependencies,
) => Promise<FeatureMountHandle>;

export interface CandidateFeatureRegistrationDependencies {
  readonly data: FoundationDataPort;
  readonly mount?: CandidateManagementMount;
  readonly getAvailability?: () => Availability;
  readonly subscribeAvailability?: (
    listener: (availability: Availability) => void,
  ) => () => void;
}

const mountCandidateManagementShell: CandidateManagementMount = async ({
  container,
}) => {
  const view = document.createElement("section");
  view.className = "candidate-management";
  view.textContent = "Candidate management";
  container.replaceChildren(view);
  let unmounted = false;
  return {
    async unmount() {
      if (unmounted) return;
      unmounted = true;
      container.replaceChildren();
    },
  };
};

/** Connects only feature-owned composition dependencies to the application shell. */
export const createCandidateFeatureRegistration = (
  dependencies: CandidateFeatureRegistrationDependencies,
): ApplicationFeatureRegistration<CandidateManagementPublicApi> => {
  const mount = dependencies.mount ?? mountCandidateManagementShell;
  const getAvailability =
    dependencies.getAvailability ?? (() => ({ status: "available" as const }));
  const subscribeAvailability = dependencies.subscribeAvailability ?? (() => () => {});
  const publicApi = createCandidateManagementPublicApi({ data: dependencies.data });

  return {
    id: candidateManagementFeatureId,
    navigation: { label: "候補管理", order: 20 },
    publicApi,
    getAvailability,
    subscribeAvailability,
    mount(context: FeatureMountContext) {
      return mount({
        container: context.container,
        data: dependencies.data,
        operationPolicy: context.operationPolicy,
        reportError: context.reportError,
        ...(context.restoredState === undefined
          ? {}
          : { restoredState: context.restoredState }),
      });
    },
  };
};
