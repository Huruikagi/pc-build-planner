import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import type {
  ApplicationFeatureRegistration,
  Availability,
  FeatureId,
  FeatureMountContext,
  FeatureMountHandle,
  OperationPolicy,
} from "../../application-shell/public.js";
import type { ProjectId } from "../../domain/public.js";
import { LanguageProvider } from "../../ui-language/public.js";
import type { CurrentBuildQuery } from "./contracts.js";
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
}

/**
 * A non-authoritative peek at the untrusted snapshot's target project, used
 * only to decide which project's candidates to load before validating.
 * `codec.restore` is the sole authority on whether the reference is real.
 */
const peekSelectedProjectId = (input: unknown): string | null | undefined => {
  if (typeof input !== "object" || input === null) return undefined;
  const value = (input as Record<string, unknown>).selectedProjectId;
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
};

const mountBuildView =
  (state: BuildState): CurrentBuildMount =>
  async ({ container, operationPolicy, restoredState }) => {
    state.attachOperationPolicy(operationPolicy);
    /** A mount starts from persisted data; only a snapshot may restore a screen. */
    state.resetTransientState();
    const root: Root = createRoot(container);
    root.render(
      createElement(
        LanguageProvider,
        null,
        createElement(BuildView, { state }),
      ),
    );
    let unmounted = false;

    await state.load();
    const codec = createBuildStateSnapshotCodec(state);
    if (restoredState !== undefined) {
      const peeked = peekSelectedProjectId(restoredState);
      if (
        peeked !== undefined &&
        peeked !== null &&
        peeked !== state.value.selectedProjectId
      ) {
        await state.selectProject(peeked as ProjectId);
      }
      const restored = codec.restore(restoredState);
      if (restored.ok) {
        state.applySnapshot(restored.value);
      } else {
        await state.load();
        state.rejectSnapshotRestore();
      }
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
        container.replaceChildren();
      },
    };
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
): ApplicationFeatureRegistration<CurrentBuildPublicApi> => {
  const mount =
    dependencies.mount ??
    (dependencies.state === undefined
      ? mountUnavailable
      : mountBuildView(dependencies.state));
  const getAvailability =
    dependencies.getAvailability ?? (() => ({ status: "available" as const }));
  const subscribeAvailability =
    dependencies.subscribeAvailability ?? (() => () => {});
  const publicApi = createCurrentBuildPublicApi({ query: dependencies.query });

  return {
    id: currentBuildFeatureId,
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
