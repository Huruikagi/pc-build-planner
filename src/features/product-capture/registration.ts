import type {
  ActivationId,
  Availability,
  FeatureActivationError,
  FeatureActivationIntent,
  FeatureMountContext,
  FeatureMountHandle,
  TargetTabId,
  TransientActivationRequest,
  TransientApplicationFeatureRegistration,
} from "../../application-shell/public.js";
import { err, ok, type Result } from "../../domain/public.js";
import {
  createProductCapturePublicApi,
  type ProductCapturePublicApi,
  productCaptureFeatureId,
} from "./public.js";
import { mountCaptureReactRoot } from "./react-root.js";
import type { CaptureState } from "./state.js";

export { productCaptureFeatureId };

export interface CaptureTransientActivation {
  readonly activationId: ActivationId;
  readonly tabId: TargetTabId;
}

export interface CaptureFeatureRegistrationDependencies {
  readonly state: CaptureState;
  readonly publicApi?: ProductCapturePublicApi;
  readonly getAvailability?: () => Availability;
  readonly subscribeAvailability?: (
    listener: (availability: Availability) => void,
  ) => () => void;
}

const validateActivation = (
  intent: FeatureActivationIntent,
): Result<CaptureTransientActivation, FeatureActivationError> => {
  const payload = intent.payload;
  if (
    intent.target !== "capture" ||
    typeof payload !== "object" ||
    payload === null ||
    !("activationId" in payload) ||
    !("tabId" in payload) ||
    typeof payload.activationId !== "string" ||
    payload.activationId.length === 0 ||
    typeof payload.tabId !== "number" ||
    !Number.isSafeInteger(payload.tabId) ||
    payload.tabId <= 0
  )
    return err({
      kind: "invalid_activation",
      detail: "invalid product capture activation",
    });
  return ok({
    activationId: payload.activationId as ActivationId,
    tabId: payload.tabId as TargetTabId,
  });
};

export const createProductCaptureFeatureRegistration = (
  dependencies: CaptureFeatureRegistrationDependencies,
): TransientApplicationFeatureRegistration<
  ProductCapturePublicApi,
  TransientActivationRequest,
  CaptureTransientActivation
> => ({
  id: productCaptureFeatureId,
  presentation: "transient",
  publicApi: dependencies.publicApi ?? createProductCapturePublicApi(),
  getAvailability:
    dependencies.getAvailability ?? (() => ({ status: "available" })),
  subscribeAvailability: dependencies.subscribeAvailability ?? (() => () => {}),
  activation: {
    validate: validateActivation,
    async activate(input) {
      dependencies.state.activate(input.activationId, input.tabId);
      return ok(undefined);
    },
  },
  transientActivation: {
    validate(request: TransientActivationRequest) {
      if (
        request.surfaceId !== productCaptureFeatureId ||
        request.activationId.length === 0 ||
        !Number.isSafeInteger(request.tabId) ||
        request.tabId <= 0
      )
        return err({
          kind: "invalid_activation",
          detail: "invalid product capture surface",
        });
      return ok(request);
    },
    async accept(input: TransientActivationRequest) {
      dependencies.state.activate(input.activationId, input.tabId);
      let released = false;
      return ok({
        async release() {
          if (released) return;
          released = true;
          if (dependencies.state.value?.activationId === input.activationId)
            dependencies.state.deactivate();
        },
      });
    },
  },
  async mount(context: FeatureMountContext): Promise<FeatureMountHandle> {
    if (dependencies.state.value === null)
      throw new Error("Product capture has not been activated.");
    const root = mountCaptureReactRoot(context.container, {
      state: dependencies.state,
    });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    let unmounted = false;
    return {
      async unmount() {
        if (unmounted) return;
        unmounted = true;
        root.unmount();
      },
    };
  },
});
