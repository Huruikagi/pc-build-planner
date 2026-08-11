import { err, ok, type ProjectId, type Result } from "../domain/public.js";
import {
  createProjectContextSnapshot,
  unavailableProjectContextSnapshot,
} from "./catalog.js";
import type {
  ProjectCatalogProjection,
  ProjectContextChangeGuard,
  ProjectContextSnapshot,
  ProjectPreferencePort,
} from "./contracts.js";
import {
  createProjectChangeGuardCoordinator,
  type ProjectChangeGuardCoordinator,
  type ProjectChangeGuardError,
  type ProjectSwitchConfirmation,
} from "./guard-coordinator.js";

export type ProjectContextLifecycleError = {
  readonly kind: "context-unavailable";
};

export type ProjectContextCommandError =
  | ProjectContextLifecycleError
  | { readonly kind: "project-not-found" }
  | Extract<
      ProjectChangeGuardError,
      { readonly kind: "guard-failed" | "confirmation-stale" }
    >
  | { readonly kind: "preference-write-failed" };

export type ProjectSelectionOutcome =
  | { readonly kind: "selected"; readonly snapshot: ProjectContextSnapshot }
  | {
      readonly kind: "confirmation-required";
      readonly confirmation: ProjectSwitchConfirmation;
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
  select(
    projectId: ProjectId,
  ): Promise<Result<ProjectSelectionOutcome, ProjectContextCommandError>>;
  confirm(
    confirmationId: string,
  ): Promise<Result<ProjectContextSnapshot, ProjectContextCommandError>>;
  cancel(confirmationId: string): Result<void, ProjectContextCommandError>;
  registerGuard(
    guard: ProjectContextChangeGuard,
  ): ReturnType<ProjectChangeGuardCoordinator["register"]>;
  prepareReplacement(): ReturnType<
    ProjectChangeGuardCoordinator["prepareReplacement"]
  >;
  confirmReplacement(
    confirmationId: string,
  ): ReturnType<ProjectChangeGuardCoordinator["confirmReplacement"]>;
  cancelReplacement(
    confirmationId: string,
  ): ReturnType<ProjectChangeGuardCoordinator["cancelReplacement"]>;
  beginReplacement(
    permitId: string,
  ): ReturnType<ProjectChangeGuardCoordinator["beginReplacement"]>;
  completeReplacement(
    permitId: string,
    outcome: "succeeded" | "failed" | "cancelled",
  ): ReturnType<ProjectChangeGuardCoordinator["completeReplacement"]>;
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
  const guards = createProjectChangeGuardCoordinator({
    getSnapshot: () => snapshot,
  });
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
    const previous = snapshot;
    const publishLoaded = async (
      next: ProjectContextSnapshot,
      catalogInvalidated: boolean,
    ): Promise<
      Result<ProjectContextSnapshot, ProjectContextLifecycleError>
    > => {
      const committed = publish(next);
      if (!initial && catalogInvalidated && previous.status === "ready") {
        await guards.notifyForcedSelection({
          kind: "select-project",
          from: previous.selectedProjectId,
          to: committed.status === "ready" ? committed.selectedProjectId : null,
          cause: "catalog-invalidated",
        });
      }
      return ok(committed);
    };
    const catalog = await input.catalog.load();
    if (!catalog.ok)
      return publishLoaded(
        unavailableProjectContextSnapshot(
          snapshot.generation + 1,
          "catalog-unavailable",
        ),
        false,
      );
    if (catalog.value.length === 0) {
      const cleared = await input.preference.clear();
      if (!cleared.ok)
        return publishLoaded(
          unavailableProjectContextSnapshot(
            snapshot.generation + 1,
            "preference-write-failed",
          ),
          previous.status === "ready",
        );
      return publishLoaded(
        createProjectContextSnapshot({
          generation: snapshot.generation + 1,
          catalog,
          preferredProjectId: null,
        }),
        previous.status === "ready",
      );
    }
    const catalogInvalidated =
      previous.status === "ready" &&
      !catalog.value.some(
        (project) => project.id === previous.selectedProjectId,
      );
    const stored = await input.preference.read();
    if (!stored.ok)
      return publishLoaded(
        unavailableProjectContextSnapshot(
          snapshot.generation + 1,
          "preference-unavailable",
        ),
        catalogInvalidated,
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
    if (next.status !== "ready") return publishLoaded(next, catalogInvalidated);
    if (
      stored.value.kind !== "valid" ||
      stored.value.selectedProjectId !== next.selectedProjectId
    ) {
      const repaired = await input.preference.write(next.selectedProjectId);
      if (!repaired.ok)
        return publishLoaded(
          unavailableProjectContextSnapshot(
            snapshot.generation + 1,
            "preference-write-failed",
          ),
          catalogInvalidated,
        );
    }
    return publishLoaded(next, catalogInvalidated);
  };
  const select = async (
    projectId: ProjectId,
  ): Promise<Result<ProjectSelectionOutcome, ProjectContextCommandError>> => {
    if (snapshot.status !== "ready")
      return err({ kind: "context-unavailable" });
    if (!snapshot.catalog.some((item) => item.id === projectId))
      return err({ kind: "project-not-found" });
    if (snapshot.selectedProjectId === projectId)
      return ok({ kind: "selected", snapshot });
    const intent = {
      kind: "select-project" as const,
      from: snapshot.selectedProjectId,
      to: projectId,
      cause: "user" as const,
    };
    const assessed = await guards.evaluateSelection(intent);
    if (!assessed.ok) {
      if (
        assessed.error.kind === "guard-failed" ||
        assessed.error.kind === "confirmation-stale"
      )
        return err(assessed.error);
      return err({ kind: "guard-failed" });
    }
    if (assessed.value.kind === "confirmation-required")
      return ok(assessed.value);
    const written = await input.preference.write(projectId);
    if (!written.ok) return err({ kind: "preference-write-failed" });
    return ok({
      kind: "selected",
      snapshot: publish({
        ...snapshot,
        generation: snapshot.generation + 1,
        selectedProjectId: projectId,
      }),
    });
  };
  const commitConfirmedSelection = async (
    projectId: ProjectId,
  ): Promise<Result<ProjectContextSnapshot, ProjectContextCommandError>> => {
    if (
      snapshot.status !== "ready" ||
      !snapshot.catalog.some((item) => item.id === projectId)
    )
      return err({ kind: "confirmation-stale" });
    const written = await input.preference.write(projectId);
    if (!written.ok) return err({ kind: "preference-write-failed" });
    return ok(
      publish({
        ...snapshot,
        generation: snapshot.generation + 1,
        selectedProjectId: projectId,
      }),
    );
  };
  const confirm = async (
    confirmationId: string,
  ): Promise<Result<ProjectContextSnapshot, ProjectContextCommandError>> => {
    const confirmed = await guards.confirmSelection(confirmationId);
    if (!confirmed.ok) {
      if (
        confirmed.error.kind === "guard-failed" ||
        confirmed.error.kind === "confirmation-stale"
      )
        return err(confirmed.error);
      return err({ kind: "guard-failed" });
    }
    const selected = await commitConfirmedSelection(confirmed.value.intent.to);
    if (!selected.ok) return selected;
    await guards.notifyForcedSelection(confirmed.value.intent);
    return selected;
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
    select: (projectId) => enqueue(() => select(projectId)),
    confirm: (confirmationId) => enqueue(() => confirm(confirmationId)),
    cancel: (confirmationId) => {
      const cancelled = guards.cancelSelection(confirmationId);
      if (cancelled.ok) return cancelled;
      return err(
        cancelled.error.kind === "confirmation-stale"
          ? cancelled.error
          : { kind: "guard-failed" },
      );
    },
    registerGuard: (guard) => guards.register(guard),
    prepareReplacement: () => guards.prepareReplacement(),
    confirmReplacement: (confirmationId) =>
      guards.confirmReplacement(confirmationId),
    cancelReplacement: (confirmationId) =>
      guards.cancelReplacement(confirmationId),
    beginReplacement: (permitId) => guards.beginReplacement(permitId),
    completeReplacement: (permitId, outcome) =>
      guards.completeReplacement(permitId, outcome),
  };
};
