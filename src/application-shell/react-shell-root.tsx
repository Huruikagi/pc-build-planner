import type { ReactNode } from "react";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root as ReactDomRoot } from "react-dom/client";

import { LanguageProvider } from "../ui-language/public.js";
import type { ShellViewState } from "./contracts.js";

export interface ShellStateSource {
  getSnapshot(): ShellViewState;
  subscribe(listener: (state: ShellViewState) => void): () => void;
}

export interface ReactShellRootOptions {
  readonly container: HTMLElement;
  readonly source: ShellStateSource;
  readonly render: (state: ShellViewState) => ReactNode;
  readonly createRoot?: (container: HTMLElement) => ReactDomRoot;
}

export interface ReactShellRoot {
  mount(): void;
  stop(): void;
}

export function createReactShellRoot(
  options: ReactShellRootOptions,
): ReactShellRoot {
  const makeRoot = options.createRoot ?? createRoot;
  let mounted:
    | {
        readonly root: ReactDomRoot;
        readonly unsubscribe: () => void;
        deactivate(): void;
      }
    | undefined;

  function cleanup(): void {
    const current = mounted;
    if (current === undefined) {
      return;
    }
    mounted = undefined;
    current.deactivate();
    const failures: unknown[] = [];
    try {
      current.unsubscribe();
    } catch (error: unknown) {
      failures.push(error);
    }
    try {
      current.root.unmount();
    } catch (error: unknown) {
      failures.push(error);
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, "React shell root cleanup failed");
    }
  }

  return {
    mount() {
      cleanup();
      const root = makeRoot(options.container);
      let active = true;
      const renderState = (state: ShellViewState) => {
        if (active) {
          flushSync(() =>
            root.render(
              createElement(LanguageProvider, null, options.render(state)),
            ),
          );
        }
      };
      try {
        renderState(options.source.getSnapshot());
        const unsubscribe: unknown = options.source.subscribe(renderState);
        if (typeof unsubscribe !== "function") {
          throw new TypeError(
            "React shell state subscription must return a cleanup function",
          );
        }
        mounted = {
          root,
          unsubscribe: () => {
            unsubscribe();
          },
          deactivate() {
            active = false;
          },
        };
      } catch (error: unknown) {
        active = false;
        try {
          root.unmount();
        } catch (cleanupError: unknown) {
          throw new AggregateError(
            [error, cleanupError],
            "React shell root startup and cleanup failed",
          );
        }
        throw error;
      }
    },
    stop: cleanup,
  };
}
