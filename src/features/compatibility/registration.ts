import type {
  ApplicationFeatureRegistration,
  Availability,
  FeatureId,
  FeatureMountContext,
  FeatureMountHandle,
  OperationPolicy,
} from "../../application-shell/public.js";
import type { ProjectId } from "../../domain/public.js";
import type { CompatibilityQuery } from "./contracts.js";
import {
  type CompatibilityPublicApi,
  createCompatibilityPublicApi,
} from "./public.js";
import { mountCompatibilityReactRoot } from "./react-root.js";
import type { CompatibilityState } from "./state.js";

export const compatibilityFeatureId = "compatibility" as FeatureId;

export interface CompatibilityMountDependencies {
  readonly container: HTMLElement;
  readonly operationPolicy: OperationPolicy;
  readonly reportError: (message: string) => void;
  readonly restoredState?: unknown;
}

export type CompatibilityMount = (
  dependencies: CompatibilityMountDependencies,
) => Promise<FeatureMountHandle>;

export interface CompatibilityFeatureRegistrationDependencies {
  readonly query: CompatibilityQuery;
  readonly mount?: CompatibilityMount;
  readonly getAvailability?: () => Availability;
  readonly subscribeAvailability?: (
    listener: (availability: Availability) => void,
  ) => () => void;
  /** Supplied by the feature-local React/state composition when the screen is enabled. */
  readonly state?: CompatibilityState;
  /**
   * Resolves which project's compatibility to evaluate. Project selection is
   * owned outside this spec's boundary; a `null` result mounts an idle view.
   * May resolve asynchronously (e.g. via an upstream `listProjects()` query).
   */
  readonly getProjectId?: () => ProjectId | null | Promise<ProjectId | null>;
}

const mountCompatibilityView =
  (
    state: CompatibilityState,
    getProjectId: () => ProjectId | null | Promise<ProjectId | null>,
  ): CompatibilityMount =>
  async ({ container, operationPolicy }) => {
    const root = mountCompatibilityReactRoot(container, state);
    let unmounted = false;

    const projectId = await getProjectId();
    if (projectId !== null && operationPolicy.isAllowed("read")) {
      await state.evaluate(projectId);
    }

    return {
      async unmount() {
        if (unmounted) return;
        unmounted = true;
        root.unmount();
      },
    };
  };

/**
 * A registration without a mountable state must not report success; the
 * shell then surfaces a mount failure instead of an apparently working feature.
 */
const mountUnavailable: CompatibilityMount = async () => {
  throw new Error(
    "Compatibility registration has no compatibility state to mount.",
  );
};

/** Connects only feature-owned composition dependencies to the application shell. */
export const createCompatibilityFeatureRegistration = (
  dependencies: CompatibilityFeatureRegistrationDependencies,
): ApplicationFeatureRegistration<CompatibilityPublicApi> => {
  const mount =
    dependencies.mount ??
    (dependencies.state === undefined
      ? mountUnavailable
      : mountCompatibilityView(
          dependencies.state,
          dependencies.getProjectId ?? (() => null),
        ));
  const getAvailability =
    dependencies.getAvailability ?? (() => ({ status: "available" as const }));
  const subscribeAvailability =
    dependencies.subscribeAvailability ?? (() => () => {});
  const publicApi = createCompatibilityPublicApi({ query: dependencies.query });

  return {
    id: compatibilityFeatureId,
    navigation: { label: "互換性確認", order: 50, icon: "puzzle" },
    publicApi,
    getAvailability,
    subscribeAvailability,
    mount(context: FeatureMountContext) {
      return mount({
        container: context.container,
        operationPolicy: context.operationPolicy,
        reportError: context.reportError,
        ...(context.restoredState === undefined
          ? {}
          : { restoredState: context.restoredState }),
      });
    },
  };
};
