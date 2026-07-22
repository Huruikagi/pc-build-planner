import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type {
  ApplicationFeatureRegistration,
  Availability,
  FeatureMountContext,
  FeatureMountHandle,
  OperationPolicy,
  ShellNavigator,
} from "../../application-shell/public.js";
import type { FoundationDataPort } from "../../persistence/public.js";
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
import type { ManagementState } from "./state.js";
import { createManagementStateSnapshotCodec } from "./state-snapshot.js";
import { ManagementView } from "./view.js";

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

const mountPlaceholder: CandidateManagementMount = async ({ container }) => {
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

const mountManagementView =
  (state: ManagementState): CandidateManagementMount =>
  async ({ container, restoredState }) => {
    const root = createRoot(container);
    let unmounted = false;
    root.render(createElement(ManagementView, { state }));

    await state.load();
    if (restoredState !== undefined) {
      const codec = createManagementStateSnapshotCodec(state);
      const restored = codec.restore(restoredState);
      if (restored.ok) state.applySnapshot(restored.value);
      else state.rejectSnapshotRestore();
    }

    const codec = createManagementStateSnapshotCodec(state);
    return {
      async captureState() {
        return { ok: true, value: codec.capture(state) };
      },
      async unmount() {
        if (unmounted) return;
        unmounted = true;
        root.unmount();
      },
    };
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
      ? mountPlaceholder
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
