import type {
  ApplicationWorkerRegistration,
  RegistrationError,
  WorkerRegistrationContext,
} from "../../application-shell/public.js";
import { err, ok, type Result } from "../../domain/public.js";
import { productCaptureFeatureId } from "./registration.js";
import type { CaptureState } from "./state.js";

export interface CaptureWorkerRegistrationDependencies {
  readonly state: CaptureState;
}

/** The action handler is the sole trigger for `captureCurrentTab`; nothing else runs extraction. */
export const createCaptureWorkerRegistration = (
  dependencies: CaptureWorkerRegistrationDependencies,
): ApplicationWorkerRegistration => ({
  id: productCaptureFeatureId,
  register(
    context: WorkerRegistrationContext,
  ): Result<() => void, RegistrationError> {
    try {
      const remove = context.addActionHandler(
        productCaptureFeatureId,
        async () => {
          await dependencies.state.startCapture();
        },
      );
      if (typeof remove !== "function") {
        return err({
          kind: "invalid_registration",
          detail:
            "product-capture: action handler registration returned no cleanup",
        });
      }
      return ok(remove);
    } catch {
      return err({
        kind: "invalid_registration",
        detail: "product-capture: action handler registration rejected",
      });
    }
  },
});
