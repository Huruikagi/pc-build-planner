import { ok, type Result } from "../domain/public.js";
import {
  createProjectContextSnapshot,
  unavailableProjectContextSnapshot,
} from "./catalog.js";
import type {
  ProjectCatalogProjection,
  ProjectContextSnapshot,
  ProjectPreferencePort,
} from "./contracts.js";

export type ProjectContextLifecycleError = {
  readonly kind: "context-unavailable";
};

export interface ProjectContextService {
  getSnapshot(): ProjectContextSnapshot;
  subscribe(listener: (snapshot: ProjectContextSnapshot) => void): () => void;
  initialize(): Promise<
    Result<ProjectContextSnapshot, ProjectContextLifecycleError>
  >;
  refresh(): Promise<
    Result<ProjectContextSnapshot, ProjectContextLifecycleError>
  >;
}

/** 初期化・refresh の catalog/preference transaction を一つの queue へ直列化する。 */
export const createProjectContextService = (input: {
  readonly catalog: ProjectCatalogProjection;
  readonly preference: ProjectPreferencePort;
}): ProjectContextService => {
  let snapshot: ProjectContextSnapshot = unavailableProjectContextSnapshot(
    0,
    "not-initialized",
  );
  let queued = Promise.resolve();
  const listeners = new Set<(snapshot: ProjectContextSnapshot) => void>();
  const publish = (next: ProjectContextSnapshot): ProjectContextSnapshot => {
    snapshot = next;
    for (const listener of [...listeners]) {
      try {
        listener(snapshot);
      } catch {
        /* listener isolation */
      }
    }
    return snapshot;
  };
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queued.then(work, work);
    queued = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
  const load = async (
    initial: boolean,
  ): Promise<Result<ProjectContextSnapshot, ProjectContextLifecycleError>> => {
    const catalog = await input.catalog.load();
    if (!catalog.ok)
      return ok(
        publish(
          unavailableProjectContextSnapshot(
            snapshot.generation + 1,
            "catalog-unavailable",
          ),
        ),
      );
    if (catalog.value.length === 0) {
      const cleared = await input.preference.clear();
      if (!cleared.ok)
        return ok(
          publish(
            unavailableProjectContextSnapshot(
              snapshot.generation + 1,
              "preference-write-failed",
            ),
          ),
        );
      return ok(
        publish(
          createProjectContextSnapshot({
            generation: snapshot.generation + 1,
            catalog,
            preferredProjectId: null,
          }),
        ),
      );
    }
    const stored = await input.preference.read();
    if (!stored.ok)
      return ok(
        publish(
          unavailableProjectContextSnapshot(
            snapshot.generation + 1,
            "preference-unavailable",
          ),
        ),
      );
    const current =
      !initial && snapshot.status === "ready"
        ? snapshot.selectedProjectId
        : null;
    const preferred =
      current ??
      (stored.value.kind === "valid" ? stored.value.selectedProjectId : null);
    const next = createProjectContextSnapshot({
      generation: snapshot.generation + 1,
      catalog,
      preferredProjectId: preferred,
    });
    if (next.status !== "ready") return ok(publish(next));
    if (
      stored.value.kind !== "valid" ||
      stored.value.selectedProjectId !== next.selectedProjectId
    ) {
      const repaired = await input.preference.write(next.selectedProjectId);
      if (!repaired.ok)
        return ok(
          publish(
            unavailableProjectContextSnapshot(
              snapshot.generation + 1,
              "preference-write-failed",
            ),
          ),
        );
    }
    return ok(publish(next));
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    initialize: () => enqueue(() => load(true)),
    refresh: () => enqueue(() => load(false)),
  };
};
