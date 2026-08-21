import type {
  Availability,
  FeatureMountContext,
  FeatureMountHandle,
  OperationPolicy,
  PersistentApplicationFeatureRegistration,
} from "../../application-shell/public.js";
import type { FoundationScopedDataPort } from "../../persistence/public.js";
import type { ProjectLifecyclePresentationContribution } from "../../project-context/public.js";
import {
  type CandidateActivationPrefill,
  candidateManagementFeatureId,
  createCandidateActivation,
} from "./activation.js";
import type {
  CandidateCreatePort,
  CandidateManagementQuery,
  CandidateQuery,
  CandidateSourceCatalogPort,
  CandidateSourceMutationPort,
} from "./contracts.js";
import { createDuplicateMergeStateSnapshotCodec } from "./duplicate-merge-state.js";
import { createProjectLifecycleHostAdapter } from "./project-lifecycle-host-adapter.js";
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
  readonly query: CandidateManagementQuery;
  readonly create: CandidateCreatePort;
  readonly publicQuery?: CandidateQuery;
  readonly sources?: {
    readonly catalog: CandidateSourceCatalogPort;
    readonly mutations: CandidateSourceMutationPort;
  };
  readonly mount?: CandidateManagementMount;
  readonly getAvailability?: () => Availability;
  readonly subscribeAvailability?: (
    listener: (availability: Availability) => void,
  ) => () => void;
  /** Supplied by the feature-local React/state composition when activation is enabled. */
  readonly state?: ManagementState;
  /** Feature-local lifecycle resource such as the project-context guard. */
  readonly lifecycle?: {
    start():
      | { readonly ok: true; readonly value: () => void }
      | { readonly ok: false; readonly error: unknown };
  };
  /** Canonical project lifecycle UI; candidate management only owns its host. */
  readonly projectLifecyclePresentation?: ProjectLifecyclePresentationContribution;
}

const unavailableSources = {
  catalog: {
    async listSourceReferences() {
      return {
        ok: false as const,
        error: { code: "storage-unavailable" as const },
      };
    },
    async getSourceReference() {
      return {
        ok: false as const,
        error: { code: "storage-unavailable" as const },
      };
    },
  },
  mutations: {
    async addSource() {
      return {
        ok: false as const,
        error: { code: "storage-unavailable" as const },
      };
    },
    async updateSource() {
      return {
        ok: false as const,
        error: { code: "storage-unavailable" as const },
      };
    },
    async patchSourcePrice() {
      return {
        ok: false as const,
        error: { code: "storage-unavailable" as const },
      };
    },
    async removeSource() {
      return {
        ok: false as const,
        error: { code: "storage-unavailable" as const },
      };
    },
    async setPrimarySource() {
      return {
        ok: false as const,
        error: { code: "storage-unavailable" as const },
      };
    },
  },
} satisfies {
  readonly catalog: CandidateSourceCatalogPort;
  readonly mutations: CandidateSourceMutationPort;
};

const mountManagementView =
  (
    state: ManagementState,
    projectLifecyclePresentation?: ProjectLifecyclePresentationContribution,
  ): CandidateManagementMount =>
  async ({ container, operationPolicy, restoredState }) => {
    state.attachOperationPolicy(operationPolicy);
    /** A mount starts from persisted data; only a snapshot may restore a screen. */
    state.resetTransientState();
    /** Context recovery is observed for the mounted panel session only. */
    state.attachCurrentProject();
    const lifecycleContainer = document.createElement("section");
    lifecycleContainer.dataset.region = "project-lifecycle-host";
    const managementContainer = document.createElement("div");
    container.replaceChildren(lifecycleContainer, managementContainer);
    const lifecycleHost =
      projectLifecyclePresentation === undefined
        ? undefined
        : createProjectLifecycleHostAdapter(projectLifecyclePresentation).mount(
            lifecycleContainer,
          );
    if (lifecycleHost !== undefined && !lifecycleHost.ok) {
      state.releaseOperationPolicy();
      state.releaseCurrentProject();
      container.replaceChildren();
      throw new Error("Project lifecycle presentation could not mount.");
    }
    const releaseLifecyclePresentation =
      lifecycleHost?.ok === true ? lifecycleHost.value : () => {};
    const root = mountManagementReactRoot(managementContainer, state);
    let unmounted = false;
    const cleanup = () => {
      if (unmounted) return;
      unmounted = true;
      try {
        root.unmount();
      } finally {
        try {
          releaseLifecyclePresentation();
        } finally {
          state.releaseCurrentProject();
          state.releaseOperationPolicy();
          container.replaceChildren();
        }
      }
    };

    try {
      await state.load();
    } catch (error) {
      cleanup();
      throw error;
    }
    const codec = createManagementStateSnapshotCodec(
      state,
      createDuplicateMergeStateSnapshotCodec(),
    );
    if (restoredState !== undefined) {
      const restored = codec.restore(restoredState);
      const current = state.resolveCurrentProject();
      const contextMatches =
        restored.ok &&
        current.status === "resolved" &&
        restored.value.selectedProjectId === current.projectId;
      if (restored.ok && contextMatches) state.applySnapshot(restored.value);
      else if (state.value.pendingPreEdit === null)
        state.rejectSnapshotRestore();
    }

    return {
      async captureState() {
        return { ok: true, value: codec.capture(state) };
      },
      async unmount() {
        cleanup();
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
): PersistentApplicationFeatureRegistration<
  CandidateManagementPublicApi,
  CandidateActivationPrefill
> => {
  let reportActivationDiagnostic: ((message: string) => void) | undefined;
  const activation =
    dependencies.state === undefined
      ? undefined
      : createCandidateActivation(dependencies.state, (code) => {
          reportActivationDiagnostic?.(`activation-${code}`);
        });
  const mount =
    dependencies.mount ??
    (dependencies.state === undefined
      ? mountUnavailable
      : mountManagementView(
          dependencies.state,
          dependencies.projectLifecyclePresentation,
        ));
  const getAvailability =
    dependencies.getAvailability ?? (() => ({ status: "available" as const }));
  const subscribeAvailability =
    dependencies.subscribeAvailability ?? (() => () => {});
  const publicApi = createCandidateManagementPublicApi({
    create: dependencies.create,
    query: dependencies.publicQuery ?? {
      listProjects: () => dependencies.query.listProjects(),
      listCandidates: (input) => dependencies.query.listCandidates(input),
      listBuildEligible: (projectId) =>
        dependencies.query.listBuildEligible(projectId),
      async getCandidateDraft() {
        return { ok: false, error: { code: "storage-unavailable" } };
      },
    },
    sources: dependencies.sources ?? unavailableSources,
  });

  return {
    id: candidateManagementFeatureId,
    presentation: "persistent",
    navigation: {
      labelKey: "nav.candidateManagement",
      order: 20,
      icon: "list",
    },
    publicApi,
    getAvailability,
    subscribeAvailability,
    async mount(context: FeatureMountContext) {
      const started = dependencies.lifecycle?.start();
      if (started !== undefined && !started.ok)
        throw new Error("Candidate management lifecycle could not start.");
      const releaseLifecycle = started?.ok ? started.value : () => {};
      let handle: FeatureMountHandle;
      try {
        handle = await mount({
          container: context.container,
          data: dependencies.data,
          operationPolicy: context.operationPolicy,
          reportError: context.reportError,
          ...(context.restoredState === undefined
            ? {}
            : { restoredState: context.restoredState }),
        });
      } catch (error) {
        releaseLifecycle();
        throw error;
      }
      reportActivationDiagnostic = context.reportError;
      let unmounted = false;
      return {
        ...handle,
        async unmount() {
          if (unmounted) return;
          unmounted = true;
          if (reportActivationDiagnostic === context.reportError)
            reportActivationDiagnostic = undefined;
          try {
            await handle.unmount();
          } finally {
            releaseLifecycle();
          }
        },
      };
    },
    ...(activation === undefined ? {} : { activation }),
  };
};
