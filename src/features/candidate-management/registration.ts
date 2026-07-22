import type {
  ApplicationFeatureRegistration,
  Availability,
  FeatureMountContext,
  FeatureMountHandle,
  OperationPolicy,
  ShellNavigator,
} from "../../application-shell/public.js";
import type { FoundationScopedDataPort } from "../../persistence/public.js";
import {
  type CandidateEditorPrefill,
  candidateManagementFeatureId,
  createCandidateActivation,
} from "./activation.js";
import type { CandidateQuery, CaptureCandidatePort } from "./contracts.js";
import {
  type CandidateManagementPublicApi,
  createCandidateManagementPublicApi,
} from "./public.js";
import { mountManagementReactRoot } from "./react-root.js";
import type { ManagementState } from "./state.js";
import { createManagementStateSnapshotCodec } from "./state-snapshot.js";

export interface CandidateManagementMountDependencies {
  readonly container: HTMLElement;
  readonly data: FoundationScopedDataPort;
  readonly operationPolicy: OperationPolicy;
  readonly reportError: (message: string) => void;
  readonly restoredState?: unknown;
}

export type CandidateManagementMount = (
  dependencies: CandidateManagementMountDependencies,
) => Promise<FeatureMountHandle>;

export interface CandidateFeatureRegistrationDependencies {
  readonly data: FoundationScopedDataPort;
  readonly query: CandidateQuery;
  readonly capture: CaptureCandidatePort;
  readonly mount?: CandidateManagementMount;
  readonly getAvailability?: () => Availability;
  readonly subscribeAvailability?: (
    listener: (availability: Availability) => void,
  ) => () => void;
  readonly navigator?: ShellNavigator;
  /** Supplied by the feature-local React/state composition when activation is enabled. */
  readonly state?: ManagementState;
}

const mountManagementView =
  (state: ManagementState): CandidateManagementMount =>
  async ({ container, operationPolicy, restoredState }) => {
    state.attachOperationPolicy(operationPolicy);
    const root = mountManagementReactRoot(container, state);
    let unmounted = false;

    await state.load();
    const codec = createManagementStateSnapshotCodec(state);
    if (restoredState !== undefined) {
      const restored = codec.restore(restoredState);
      if (restored.ok) state.applySnapshot(restored.value);
      else state.rejectSnapshotRestore();
    }

    return {
      async captureState() {
        return { ok: true, value: codec.capture(state) };
      },
      async unmount() {
        if (unmounted) return;
        unmounted = true;
        state.releaseOperationPolicy();
        root.unmount();
      },
    };
  };

/**
 * A registration without a mountable view must not report success; the shell
 * then surfaces a mount failure instead of an apparently working feature.
 */
const mountUnavailable: CandidateManagementMount = async () => {
  throw new Error(
    "Candidate management registration has no management state to mount.",
  );
};

/** Connects only feature-owned composition dependencies to the application shell. */
export const createCandidateFeatureRegistration = (
  dependencies: CandidateFeatureRegistrationDependencies,
): ApplicationFeatureRegistration<
  CandidateManagementPublicApi,
  CandidateEditorPrefill
> => {
  const mount =
    dependencies.mount ??
    (dependencies.state === undefined
      ? mountUnavailable
      : mountManagementView(dependencies.state));
  const getAvailability =
    dependencies.getAvailability ?? (() => ({ status: "available" as const }));
  const subscribeAvailability =
    dependencies.subscribeAvailability ?? (() => () => {});
  const publicApi = createCandidateManagementPublicApi({
    data: dependencies.data,
    query: dependencies.query,
    capture: dependencies.capture,
    ...(dependencies.navigator === undefined
      ? {}
      : { navigator: dependencies.navigator }),
  });

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
    ...(dependencies.state === undefined
      ? {}
      : { activation: createCandidateActivation(dependencies.state) }),
  };
};
