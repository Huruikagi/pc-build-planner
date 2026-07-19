import { Fragment } from "react";

import { err, ok, type Result } from "../domain/public.js";
import type { FeatureId, ShellViewState } from "./contracts.js";
import { createReactShellRoot } from "./react-shell-root.js";
import { type ShellNavigationItem, ShellView } from "./shell-view.js";

export interface ShellPresentationHandle {
  readonly featureContainer: HTMLElement;
  publish(
    state: ShellViewState,
    navigation: readonly ShellNavigationItem[],
  ): void;
  stop(): void;
}

export interface ShellPresentationAdapter {
  mount(input: {
    readonly shellContainer: HTMLElement;
    readonly onNavigate: (id: FeatureId) => void;
    readonly onRetry: () => void;
  }): Result<ShellPresentationHandle, { readonly kind: "presentation_failed" }>;
}

export function createShellPresentation(): ShellPresentationAdapter {
  return {
    mount(input) {
      let state: ShellViewState = { kind: "loading" };
      let navigation: readonly ShellNavigationItem[] = [];
      const listeners = new Set<(next: ShellViewState) => void>();
      const featureSlotMarker = "application-shell-feature-slot";
      const root = createReactShellRoot({
        container: input.shellContainer,
        source: {
          getSnapshot: () => state,
          subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
        render: (next) => (
          <Fragment>
            <ShellView
              navigation={navigation}
              onNavigate={input.onNavigate}
              onRetry={input.onRetry}
              state={next}
            />
            <div data-shell-feature-slot={featureSlotMarker} />
          </Fragment>
        ),
      });

      try {
        root.mount();
        const featureContainer =
          input.shellContainer.querySelector<HTMLElement>(
            `[data-shell-feature-slot="${featureSlotMarker}"]`,
          );
        if (
          featureContainer === null ||
          featureContainer === input.shellContainer
        ) {
          root.stop();
          return err({ kind: "presentation_failed" });
        }
        let stopped = false;
        return ok({
          featureContainer,
          publish(nextState, nextNavigation) {
            if (stopped) return;
            state = nextState;
            navigation = [...nextNavigation];
            for (const listener of [...listeners]) listener(nextState);
          },
          stop() {
            if (stopped) return;
            stopped = true;
            root.stop();
            listeners.clear();
          },
        });
      } catch {
        try {
          root.stop();
        } catch {
          // The adapter contract has no diagnostic channel during mount.
        }
        return err({ kind: "presentation_failed" });
      }
    },
  };
}
