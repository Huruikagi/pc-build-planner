import type { ProjectContextReadPort } from "../project-context/public.js";

/** Application-shell owned late binding for one monotonic project-context read. */
export const createMonotonicProjectReadBinding = (
  unavailable: ReturnType<ProjectContextReadPort["getSnapshot"]>,
): {
  readonly read: ProjectContextReadPort;
  bind(read: ProjectContextReadPort): void;
  publish(snapshot: ReturnType<ProjectContextReadPort["getSnapshot"]>): void;
  unbind(): void;
} => {
  let snapshot = unavailable;
  let release: (() => void) | undefined;
  const listeners = new Set<
    Parameters<ProjectContextReadPort["subscribe"]>[0]
  >();
  const publish = (
    next: ReturnType<ProjectContextReadPort["getSnapshot"]>,
  ): void => {
    if (next.generation <= snapshot.generation) return;
    snapshot = next;
    for (const listener of [...listeners]) {
      try {
        listener(next);
      } catch {
        /* listener isolation */
      }
    }
  };
  return {
    read: {
      getSnapshot: () => snapshot,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    bind(read) {
      if (release !== undefined)
        throw new Error("project read binding is still owned");
      snapshot = read.getSnapshot();
      release = read.subscribe(publish);
    },
    publish,
    unbind() {
      const owned = release;
      owned?.();
      if (release === owned) release = undefined;
      snapshot = unavailable;
    },
  };
};
