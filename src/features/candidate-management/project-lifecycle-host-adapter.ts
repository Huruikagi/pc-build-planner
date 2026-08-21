import { err, type Result } from "../../domain/public.js";
import type { ProjectLifecyclePresentationContribution } from "../../project-context/public.js";

export type ProjectLifecycleHostError = {
  readonly kind: "project-lifecycle-host-failed";
};

export interface ProjectLifecycleHostAdapter {
  mount(container: HTMLElement): Result<() => void, ProjectLifecycleHostError>;
}

/** Adapts the canonical host-neutral lifecycle presentation to the candidate host. */
export const createProjectLifecycleHostAdapter = (
  presentation: ProjectLifecyclePresentationContribution,
): ProjectLifecycleHostAdapter => ({
  mount(container) {
    const mounted = presentation.mount(container);
    if (!mounted.ok) return err({ kind: "project-lifecycle-host-failed" });
    let active = true;
    return {
      ok: true,
      value: () => {
        if (!active) return;
        active = false;
        mounted.value.unmount();
      },
    };
  },
});
