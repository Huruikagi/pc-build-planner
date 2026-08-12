import type { ProjectId } from "../domain/public.js";
import { err, ok, type Result } from "../domain/public.js";
import type { ProjectContextPresentationContribution } from "../project-context/presentation-contribution.js";
import type {
  ProjectContextCommandPort,
  ProjectContextReadPort,
} from "../project-context/public.js";

export type ProjectDependencyAvailability =
  | {
      readonly status: "available";
      readonly projectId: ProjectId;
      readonly generation: number;
    }
  | {
      readonly status: "unavailable";
      readonly reason: "empty" | "context-unavailable";
      readonly generation: number;
    };

export interface ProjectContextShellHandle {
  stop(): void | Promise<void>;
}

export interface ProjectContextShellAdapter {
  mount(input: {
    readonly container: HTMLElement;
    readonly read: ProjectContextReadPort;
    readonly commands: ProjectContextCommandPort;
    readonly presentation: ProjectContextPresentationContribution;
    readonly publishAvailability: (
      value: ProjectDependencyAvailability,
    ) => void;
  }): Result<
    ProjectContextShellHandle,
    { readonly kind: "project-context-mount-failed" }
  >;
}

const projectAvailability = (
  snapshot: ReturnType<ProjectContextReadPort["getSnapshot"]>,
): ProjectDependencyAvailability =>
  snapshot.status === "ready"
    ? {
        status: "available",
        projectId: snapshot.selectedProjectId,
        generation: snapshot.generation,
      }
    : {
        status: "unavailable",
        reason: snapshot.status === "empty" ? "empty" : "context-unavailable",
        generation: snapshot.generation,
      };

/** Owns exactly one project selector mount and one matching snapshot subscription. */
export const createProjectContextShellAdapter =
  (): ProjectContextShellAdapter => ({
    mount(input) {
      let presentationHandle: ReturnType<
        ProjectContextPresentationContribution["mount"]
      > extends Result<infer T, unknown>
        ? T
        : never;
      let unsubscribe: (() => void) | undefined;
      let generation = -1;

      const publish = (
        snapshot: ReturnType<ProjectContextReadPort["getSnapshot"]>,
      ): void => {
        if (snapshot.generation < generation) return;
        generation = snapshot.generation;
        input.publishAvailability(projectAvailability(snapshot));
      };
      const stop = (): void => {
        if (unsubscribe === undefined && presentationHandle === undefined)
          return;
        const failures: unknown[] = [];
        const ownedUnsubscribe = unsubscribe;
        if (ownedUnsubscribe !== undefined) {
          try {
            ownedUnsubscribe();
            if (unsubscribe === ownedUnsubscribe) unsubscribe = undefined;
          } catch (error) {
            failures.push(error);
          }
        }
        const ownedPresentation = presentationHandle;
        if (ownedPresentation !== undefined) {
          try {
            ownedPresentation.unmount();
            if (presentationHandle === ownedPresentation)
              presentationHandle = undefined as never;
          } catch (error) {
            failures.push(error);
          }
        }
        if (failures.length > 0)
          throw new AggregateError(
            failures,
            "Project context shell cleanup failed",
          );
      };

      try {
        const mounted = input.presentation.mount(input.container);
        if (!mounted.ok) return err({ kind: "project-context-mount-failed" });
        presentationHandle = mounted.value;
        publish(input.read.getSnapshot());
        unsubscribe = input.read.subscribe(publish);
        if (typeof unsubscribe !== "function")
          throw new TypeError("invalid unsubscribe");
        return ok(Object.freeze({ stop }));
      } catch {
        try {
          stop();
        } catch {
          // A failed mount is reported through the typed composition boundary.
        }
        return err({ kind: "project-context-mount-failed" });
      }
    },
  });
