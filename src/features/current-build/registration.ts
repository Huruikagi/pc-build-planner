import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import type {
  Availability,
  FeatureId,
  FeatureMountContext,
  FeatureMountHandle,
  OperationPolicy,
  PersistentApplicationFeatureRegistration,
} from "../../application-shell/public.js";
import { LanguageProvider } from "../../ui-language/public.js";
import type { CurrentBuildQuery } from "./contracts.js";
import type { CurrentBuildProjectContextAdapter } from "./project-context-adapter.js";
import {
  type CurrentBuildPublicApi,
  createCurrentBuildPublicApi,
} from "./public.js";
import type { BuildState } from "./state.js";
import { createBuildStateSnapshotCodec } from "./state-snapshot.js";
import { BuildView } from "./view.js";

export const currentBuildFeatureId = "currentBuild" as FeatureId;

export interface CurrentBuildMountDependencies {
  readonly container: HTMLElement;
  readonly operationPolicy: OperationPolicy;
  readonly reportError: (message: string) => void;
  readonly restoredState?: unknown;
}

export type CurrentBuildMount = (
  dependencies: CurrentBuildMountDependencies,
) => Promise<FeatureMountHandle>;

export interface CurrentBuildFeatureRegistrationDependencies {
  readonly query: CurrentBuildQuery;
  readonly mount?: CurrentBuildMount;
  readonly getAvailability?: () => Availability;
  readonly subscribeAvailability?: (
    listener: (availability: Availability) => void,
  ) => () => void;
  /** Supplied by the feature-local React/state composition when the screen is enabled. */
  readonly state?: BuildState;
  /** Owner-local projection of the project-context public read and guard ports. */
  readonly projectContext?: CurrentBuildProjectContextAdapter;
}

const mountBuildView =
  (
    state: BuildState,
    projectContext?: CurrentBuildProjectContextAdapter,
  ): CurrentBuildMount =>
  async ({ container, operationPolicy, restoredState }) => {
    state.attachOperationPolicy(operationPolicy);
    /** A mount starts from persisted data; only a snapshot may restore a screen. */
    state.resetTransientState();
    const guardRegistration = projectContext?.registerDraftGuard(
      state.draftGuardOwner(),
    );
    if (guardRegistration !== undefined && !guardRegistration.ok) {
      state.releaseOperationPolicy();
      throw new Error("Current build draft guard registration failed.");
    }
    const releaseGuard = guardRegistration?.ok
      ? guardRegistration.value
      : undefined;
    const root: Root = createRoot(container);
    root.render(
      createElement(
        LanguageProvider,
        null,
        createElement(BuildView, { state }),
      ),
    );
    let unmounted = false;

    try {
      if (projectContext === undefined) await state.load();
      else await state.attachProjectContext(projectContext);
      const codec = createBuildStateSnapshotCodec(state);
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
          releaseGuard?.();
          state.releaseProjectContext();
          state.releaseOperationPolicy();
          state.resetTransientState();
          root.unmount();
          container.replaceChildren();
        },
      };
    } catch (error) {
      releaseGuard?.();
      state.releaseProjectContext();
      state.releaseOperationPolicy();
      root.unmount();
      container.replaceChildren();
      throw error;
    }
  };

/**
 * A registration without a mountable view must not report success; the shell
 * then surfaces a mount failure instead of an apparently working feature.
 */
const mountUnavailable: CurrentBuildMount = async () => {
  throw new Error("Current build registration has no build state to mount.");
};

/** Connects only feature-owned composition dependencies to the application shell. */
export const createCurrentBuildFeatureRegistration = (
  dependencies: CurrentBuildFeatureRegistrationDependencies,
): PersistentApplicationFeatureRegistration<CurrentBuildPublicApi> => {
  const mount =
    dependencies.mount ??
    (dependencies.state === undefined
      ? mountUnavailable
      : mountBuildView(dependencies.state, dependencies.projectContext));
  const getAvailability =
    dependencies.getAvailability ?? (() => ({ status: "available" as const }));
  const subscribeAvailability =
    dependencies.subscribeAvailability ?? (() => () => {});
  const publicApi = createCurrentBuildPublicApi({ query: dependencies.query });

  return {
    id: currentBuildFeatureId,
    presentation: "persistent",
    navigation: { labelKey: "nav.currentBuild", order: 30, icon: "cpu" },
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
