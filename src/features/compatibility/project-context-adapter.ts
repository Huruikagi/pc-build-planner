import type { ProjectId } from "../../domain/public.js";
import type {
  ProjectContextReadPort,
  ProjectContextSnapshot,
} from "../../project-context/public.js";

export type CompatibilityProjectAvailability =
  | {
      readonly status: "ready";
      readonly generation: number;
      readonly projectId: ProjectId;
    }
  | { readonly status: "empty"; readonly generation: number }
  | { readonly status: "unavailable"; readonly generation: number };

export interface CompatibilityProjectContextAdapter {
  getCurrent(): CompatibilityProjectAvailability;
  subscribe(
    listener: (value: CompatibilityProjectAvailability) => void,
  ): () => void;
}

const project = (
  snapshot: ProjectContextSnapshot,
): CompatibilityProjectAvailability =>
  snapshot.status === "ready"
    ? {
        status: "ready",
        generation: snapshot.generation,
        projectId: snapshot.selectedProjectId,
      }
    : { status: snapshot.status, generation: snapshot.generation };

const sameAvailability = (
  left: CompatibilityProjectAvailability,
  right: CompatibilityProjectAvailability,
): boolean =>
  left.status === right.status &&
  left.generation === right.generation &&
  (left.status !== "ready" ||
    right.status !== "ready" ||
    left.projectId === right.projectId);

/**
 * project-context の検証済みsnapshotを互換性評価に必要なavailabilityだけへ射影する。
 * catalog、preference、fallback選択は所有しない。
 */
export const createCompatibilityProjectContextAdapter = (
  read: ProjectContextReadPort,
): CompatibilityProjectContextAdapter => {
  const listeners = new Set<
    (value: CompatibilityProjectAvailability) => void
  >();
  let unsubscribeRead: (() => void) | null = null;
  let delivered: CompatibilityProjectAvailability | null = null;

  const publish = (snapshot: ProjectContextSnapshot) => {
    const next = project(snapshot);
    if (delivered !== null && next.generation < delivered.generation) return;
    const previous = delivered;
    delivered = next;
    if (previous !== null && sameAvailability(previous, next)) return;
    for (const listener of [...listeners]) listener(next);
  };

  return {
    getCurrent: () => project(read.getSnapshot()),
    subscribe(listener) {
      listeners.add(listener);
      if (unsubscribeRead === null) {
        delivered = project(read.getSnapshot());
        unsubscribeRead = read.subscribe(publish);
      }
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(listener);
        if (listeners.size > 0 || unsubscribeRead === null) return;
        const release = unsubscribeRead;
        unsubscribeRead = null;
        delivered = null;
        release();
      };
    },
  };
};
