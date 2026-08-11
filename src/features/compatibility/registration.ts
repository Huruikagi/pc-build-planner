import type {
  Availability,
  FeatureId,
  FeatureMountContext,
  FeatureMountHandle,
  OperationPolicy,
  PersistentApplicationFeatureRegistration,
} from "../../application-shell/public.js";
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
}

const mountCompatibilityView =
  (state: CompatibilityState): CompatibilityMount =>
  async ({ container, operationPolicy }) => {
    const root = mountCompatibilityReactRoot(
      container,
      state,
      operationPolicy.isAllowed("read"),
    );
    return {
      async unmount() {
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
): PersistentApplicationFeatureRegistration<CompatibilityPublicApi> => {
  const mount =
    dependencies.mount ??
    (dependencies.state === undefined
      ? mountUnavailable
      : mountCompatibilityView(dependencies.state));
  const getAvailability =
    dependencies.getAvailability ?? (() => ({ status: "available" as const }));
  const subscribeAvailability =
    dependencies.subscribeAvailability ?? (() => () => {});
  const publicApi = createCompatibilityPublicApi({ query: dependencies.query });

  return {
    id: compatibilityFeatureId,
    presentation: "persistent",
    navigation: { labelKey: "nav.compatibility", order: 50, icon: "puzzle" },
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
