import type {
  ActivationId,
  Availability,
  FeatureId,
  FeatureMountContext,
  FeatureMountHandle,
  TargetTabId,
  TransientActivationLease,
  TransientActivationRequest,
  TransientApplicationFeatureRegistration,
} from "../../application-shell/public.js";
import { parseTargetTabId } from "../../application-shell/public.js";
import { err, ok } from "../../domain/public.js";
import type { SourcePriceRefreshPublicApi } from "./contracts.js";
import { sourcePriceRefreshFeatureId } from "./public.js";
import { mountSourcePriceRefreshReactRoot } from "./react-root.js";
import type { SourcePriceRefreshState } from "./state.js";

/**
 * The activation generation and tab one refresh run is pinned to. `surfaceId`
 * is retained so the value stays a canonical `TransientActivationRequest`,
 * which is what the shell registry and side panel host accept; the pair the
 * workflow actually uses is `activationId` + `tabId`.
 */
export interface SourcePriceRefreshTransientActivation {
  readonly activationId: ActivationId;
  readonly surfaceId: FeatureId;
  readonly tabId: TargetTabId;
}

export type SourcePriceRefreshFeatureRegistration =
  TransientApplicationFeatureRegistration<
    SourcePriceRefreshPublicApi,
    SourcePriceRefreshTransientActivation
  >;

export interface SourcePriceRefreshRegistrationDependencies {
  /**
   * Builds one refresh state per accepted activation. The state is a
   * single-use generation holder — `unmount` retires it permanently — so a new
   * one is created for every mount rather than shared across activations.
   */
  readonly createState: () => SourcePriceRefreshState;
  readonly publicApi: SourcePriceRefreshPublicApi;
  readonly getAvailability?: () => Availability;
  readonly subscribeAvailability?: (
    listener: (availability: Availability) => void,
  ) => () => void;
}

/**
 * The transient side panel surface for one price refresh.
 *
 * It is a canonical transient registration: `presentation` is stated
 * explicitly and no `navigation` metadata exists, so the shell cannot list it
 * in persistent navigation and cannot select it (requirement 1.6). It also
 * declares no handoff `activation` adapter, so the only way in is a transient
 * request carrying a live activation generation and a fixed tab — the context
 * menu gesture path. Anything else fails closed at `validate` and never
 * reaches the workflow (requirements 1.1, 1.5).
 */
export const createSourcePriceRefreshFeatureRegistration = (
  dependencies: SourcePriceRefreshRegistrationDependencies,
): SourcePriceRefreshFeatureRegistration => {
  /** Set by `accept`, consumed by the mount it authorises, and never reused. */
  let pending: SourcePriceRefreshTransientActivation | undefined;

  return {
    id: sourcePriceRefreshFeatureId,
    presentation: "transient",
    publicApi: dependencies.publicApi,
    getAvailability:
      dependencies.getAvailability ?? (() => ({ status: "available" })),
    subscribeAvailability:
      dependencies.subscribeAvailability ?? (() => () => {}),
    transientActivation: {
      validate(request: TransientActivationRequest) {
        const tab = parseTargetTabId(request.tabId);
        if (
          request.surfaceId !== sourcePriceRefreshFeatureId ||
          typeof request.activationId !== "string" ||
          request.activationId.length === 0 ||
          !tab.ok
        )
          return err({
            kind: "invalid_activation",
            detail: "invalid source price refresh activation",
          });
        return ok({
          activationId: request.activationId,
          surfaceId: request.surfaceId,
          tabId: tab.value,
        });
      },
      async accept(input: SourcePriceRefreshTransientActivation) {
        pending = input;
        let released = false;
        return ok<TransientActivationLease>({
          async release() {
            if (released) return;
            released = true;
            // Only an authorisation this lease still owns may be withdrawn; a
            // newer activation has already replaced it otherwise.
            if (pending === input) pending = undefined;
          },
        });
      },
    },
    async mount(context: FeatureMountContext): Promise<FeatureMountHandle> {
      const activation = pending;
      pending = undefined;
      if (activation === undefined)
        throw new Error("Source price refresh has not been activated.");

      const state = dependencies.createState();
      const root = mountSourcePriceRefreshReactRoot(context.container, {
        state,
      });
      await new Promise<void>((resolve) => queueMicrotask(resolve));

      /**
       * The run starts by itself, with no further gesture, but not inside the
       * mount call. The shell publishes an activation as current only once the
       * whole transient transition has drained — accept, unmount of the previous
       * surface, this mount — and every remaining step of that transition is a
       * microtask. Starting synchronously here would therefore make the very
       * first generation check see an activation the shell has not yet marked
       * current and abandon the run as stale. Scheduling it as a macrotask puts
       * the start strictly after that chain, so the workflow's three generation
       * gates all read the settled lifecycle state.
       */
      let scheduled: ReturnType<typeof setTimeout> | undefined = setTimeout(
        () => {
          scheduled = undefined;
          // The rejection handler is mandatory even though the workflow is
          // contracted to settle with a typed `Result`: an unhandled rejection
          // would dump an exception object, which this feature never surfaces
          // (requirement 5.6).
          void state
            .activate(activation.activationId, activation.tabId)
            .catch(() => {});
        },
        0,
      );

      let unmounted = false;
      return {
        async unmount() {
          if (unmounted) return;
          unmounted = true;
          // Three lifetimes end here: a run that has not started yet is never
          // started, the React root (and the container it rendered into) is
          // released, and the state generation is retired — which drops the
          // view's subscription and makes every late extraction or mutation
          // callback a no-op (requirement 5.5).
          if (scheduled !== undefined) {
            clearTimeout(scheduled);
            scheduled = undefined;
          }
          root.unmount();
          state.unmount();
        },
      };
    },
  };
};
