import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import { err, ok, type Result } from "../domain/public.js";
import { LanguageProvider } from "../ui-language/public.js";
import type {
  ProjectContextCommandPort,
  ProjectContextReadPort,
} from "./public.js";
import { ProjectSelector } from "./selector.js";

export interface ProjectContextPresentationHandle {
  unmount(): void;
}

export interface ProjectContextPresentationContribution {
  mount(
    container: HTMLElement,
  ): Result<
    ProjectContextPresentationHandle,
    { readonly kind: "presentation-failed" }
  >;
}

export interface ProjectContextPresentationDependencies {
  readonly read: ProjectContextReadPort;
  readonly commands: ProjectContextCommandPort;
}

/** Provides shell composition with a self-cleaning selector root for its exact slot. */
export const createProjectContextPresentationContribution = (
  dependencies: ProjectContextPresentationDependencies,
): ProjectContextPresentationContribution => {
  let active:
    | { readonly container: HTMLElement; readonly root: Root }
    | undefined;

  const release = (current: {
    readonly container: HTMLElement;
    readonly root: Root;
  }) => {
    if (active !== current) return;
    active = undefined;
    current.root.unmount();
    current.container.replaceChildren();
  };

  return Object.freeze({
    mount: (container: HTMLElement) => {
      if (active !== undefined)
        return err({ kind: "presentation-failed" } as const);
      try {
        const root = createRoot(container);
        const current = { container, root };
        active = current;
        flushSync(() => {
          root.render(
            <LanguageProvider>
              <ProjectSelector
                commands={dependencies.commands}
                read={dependencies.read}
              />
            </LanguageProvider>,
          );
        });
        return ok(
          Object.freeze({
            unmount: () => release(current),
          }),
        );
      } catch {
        active?.root.unmount();
        active?.container.replaceChildren();
        active = undefined;
        return err({ kind: "presentation-failed" } as const);
      }
    },
  });
};
