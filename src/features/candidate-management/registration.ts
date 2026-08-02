import type {
  Availability,
  FeatureMountContext,
  FeatureMountHandle,
  OperationPolicy,
  PersistentApplicationFeatureRegistration,
} from "../../application-shell/public.js";
import type { FoundationScopedDataPort } from "../../persistence/public.js";
import {
  type CandidateActivationPrefill,
  candidateManagementFeatureId,
  createCandidateActivation,
} from "./activation.js";
import type {
  CandidateManagementQuery,
  CandidateQuery,
  CandidateSourceCatalogPort,
  CandidateSourceMutationPort,
} from "./contracts.js";
import { createDuplicateMergeStateSnapshotCodec } from "./duplicate-merge-state.js";
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
}

const unavailableSources = {
  catalog: {
    async listSourceReferences() {
      return {
        ok: false as const,
        error: { kind: "unsupported-data" as const },
      };
    },
    async getSourceReference() {
      return {
        ok: false as const,
        error: { kind: "unsupported-data" as const },
      };
    },
  },
  mutations: {
    async addSource() {
      return {
        ok: false as const,
        error: { kind: "unsupported-data" as const },
      };
    },
    async updateSource() {
      return {
        ok: false as const,
        error: { kind: "unsupported-data" as const },
      };
    },
    async patchSourcePrice() {
      return {
        ok: false as const,
        error: { kind: "unsupported-data" as const },
      };
    },
    async removeSource() {
      return {
        ok: false as const,
        error: { kind: "unsupported-data" as const },
      };
    },
    async setPrimarySource() {
      return {
        ok: false as const,
        error: { kind: "unsupported-data" as const },
      };
    },
  },
} satisfies {
  readonly catalog: CandidateSourceCatalogPort;
  readonly mutations: CandidateSourceMutationPort;
};

const mountManagementView =
  (state: ManagementState): CandidateManagementMount =>
  async ({ container, operationPolicy, restoredState }) => {
    state.attachOperationPolicy(operationPolicy);
    /** A mount starts from persisted data; only a snapshot may restore a screen. */
    state.resetTransientState();
    const root = mountManagementReactRoot(container, state);
    let unmounted = false;

    await state.load();
    const codec = createManagementStateSnapshotCodec(
      state,
      createDuplicateMergeStateSnapshotCodec(),
    );
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
      : mountManagementView(dependencies.state));
  const getAvailability =
    dependencies.getAvailability ?? (() => ({ status: "available" as const }));
  const subscribeAvailability =
    dependencies.subscribeAvailability ?? (() => () => {});
  const publicApi = createCandidateManagementPublicApi({
    query: dependencies.publicQuery ?? {
      listProjects: () => dependencies.query.listProjects(),
      listCandidates: (input) => dependencies.query.listCandidates(input),
      listBuildEligible: (projectId) =>
        dependencies.query.listBuildEligible(projectId),
      async getCandidateDraft() {
        return { ok: false, error: { kind: "unsupported-data" } };
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
      const handle = await mount({
        container: context.container,
        data: dependencies.data,
        operationPolicy: context.operationPolicy,
        reportError: context.reportError,
        ...(context.restoredState === undefined
          ? {}
          : { restoredState: context.restoredState }),
      });
      reportActivationDiagnostic = context.reportError;
      let unmounted = false;
      return {
        ...handle,
        async unmount() {
          if (unmounted) return;
          unmounted = true;
          if (reportActivationDiagnostic === context.reportError)
            reportActivationDiagnostic = undefined;
          await handle.unmount();
        },
      };
    },
    ...(activation === undefined ? {} : { activation }),
  };
};
