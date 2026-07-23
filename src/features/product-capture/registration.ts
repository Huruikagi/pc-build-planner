import type {
  ApplicationFeatureRegistration,
  Availability,
  FeatureMountContext,
  FeatureMountHandle,
  OperationPolicy,
} from "../../application-shell/public.js";
import {
  createProductCapturePublicApi,
  type ProductCapturePublicApi,
  productCaptureFeatureId,
} from "./public.js";
import { mountCaptureReactRoot } from "./react-root.js";
import type { CaptureState } from "./state.js";
import type { CaptureProjectOption } from "./view.js";

export { productCaptureFeatureId };

export interface CaptureMountDependencies {
  readonly container: HTMLElement;
  readonly operationPolicy: OperationPolicy;
  readonly reportError: (message: string) => void;
  readonly restoredState?: unknown;
}

export type CaptureMount = (
  dependencies: CaptureMountDependencies,
) => Promise<FeatureMountHandle>;

export interface CaptureFeatureRegistrationDependencies {
  readonly mount?: CaptureMount;
  readonly getAvailability?: () => Availability;
  readonly subscribeAvailability?: (
    listener: (availability: Availability) => void,
  ) => () => void;
  /** Supplied by the feature-local React/state composition when capture is enabled. */
  readonly state?: CaptureState;
  readonly projects?: readonly CaptureProjectOption[];
  readonly onOpenDetailEdit?: (manualName?: string) => void;
}

const mountCaptureView =
  (
    state: CaptureState,
    projects: readonly CaptureProjectOption[],
    onOpenDetailEdit: ((manualName?: string) => void) | undefined,
  ): CaptureMount =>
  async ({ container }) => {
    const root = mountCaptureReactRoot(container, {
      state,
      projects,
      ...(onOpenDetailEdit === undefined ? {} : { onOpenDetailEdit }),
    });
    // Lets the initial render commit before the shell inspects the container.
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    let unmounted = false;

    return {
      async unmount() {
        if (unmounted) return;
        unmounted = true;
        root.unmount();
      },
    };
  };

/**
 * A registration without a mountable state must not report success; the shell
 * then surfaces a mount failure instead of an apparently working feature.
 */
const mountUnavailable: CaptureMount = async () => {
  throw new Error(
    "Product capture registration has no capture state to mount.",
  );
};

/** Connects only feature-owned composition dependencies to the application shell. */
export const createProductCaptureFeatureRegistration = (
  dependencies: CaptureFeatureRegistrationDependencies,
): ApplicationFeatureRegistration<ProductCapturePublicApi> => {
  const mount =
    dependencies.mount ??
    (dependencies.state === undefined
      ? mountUnavailable
      : mountCaptureView(
          dependencies.state,
          dependencies.projects ?? [],
          dependencies.onOpenDetailEdit,
        ));
  const getAvailability =
    dependencies.getAvailability ?? (() => ({ status: "available" as const }));
  const subscribeAvailability =
    dependencies.subscribeAvailability ?? (() => () => {});
  const publicApi = createProductCapturePublicApi();

  return {
    id: productCaptureFeatureId,
    navigation: { label: "商品取り込み", order: 40 },
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
