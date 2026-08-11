import type { ProjectId, Result } from "../../domain/public.js";
import type { CompatibilityError, CompatibilityReport } from "./contracts.js";
import type {
  CompatibilityProjectAvailability,
  CompatibilityProjectContextAdapter,
} from "./project-context-adapter.js";

export type CompatibilityEmptyBuildReason = "no-build" | "empty-build";
export type CompatibilityFailureReason =
  | "invalid-reference"
  | "corrupt-data"
  | "unsupported-data"
  | "read-failed";

export type CompatibilityStateValue =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly report: CompatibilityReport }
  | { readonly status: "no-projects" }
  | { readonly status: "context-unavailable" }
  | {
      readonly status: "empty-build";
      readonly reason: CompatibilityEmptyBuildReason;
    }
  | { readonly status: "failed"; readonly reason: CompatibilityFailureReason };

interface CompatibilityStateQuery {
  evaluate(
    projectId: ProjectId,
  ): Promise<Result<CompatibilityReport, CompatibilityError>>;
}

export interface CompatibilityStateDependencies {
  readonly query: CompatibilityStateQuery;
  readonly projectContext: CompatibilityProjectContextAdapter;
}

const stateForError = (error: CompatibilityError): CompatibilityStateValue => {
  switch (error.kind) {
    case "no-build":
    case "empty-build":
      return { status: "empty-build", reason: error.kind };
    case "invalid-reference":
      return { status: "failed", reason: "invalid-reference" };
    case "corrupt-data":
      return { status: "failed", reason: "corrupt-data" };
    case "unsupported-data":
      return { status: "failed", reason: "unsupported-data" };
    case "read-failed":
      return { status: "failed", reason: "read-failed" };
  }
};

/**
 * Framework-independent state for the currently selected project.
 * A completion is accepted only while both its context generation and its
 * monotonically increasing request id are still current.
 */
export class CompatibilityState {
  #listeners = new Set<() => void>();
  #requestId = 0;
  #contextGeneration: number | null = null;
  #currentProjectId: ProjectId | null = null;
  #unsubscribeContext: (() => void) | null = null;
  #value: CompatibilityStateValue = { status: "idle" };

  public constructor(
    private readonly dependencies: CompatibilityStateDependencies,
  ) {}

  public get value(): CompatibilityStateValue {
    return this.#value;
  }

  public subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      this.#listeners.delete(listener);
    };
  }

  /** Starts context tracking once and evaluates the adapter's latest snapshot. */
  public start(): void {
    const context = this.dependencies.projectContext;
    if (this.#unsubscribeContext !== null) return;
    this.#unsubscribeContext = context.subscribe((availability) => {
      void this.#applyAvailability(availability);
    });
    void this.#applyAvailability(context.getCurrent());
  }

  /** Stops context delivery and invalidates every outstanding evaluation. */
  public stop(): void {
    const unsubscribe = this.#unsubscribeContext;
    if (unsubscribe === null) return;
    this.#unsubscribeContext = null;
    unsubscribe();
    this.#requestId += 1;
    this.#contextGeneration = null;
    this.#currentProjectId = null;
  }

  /** Re-reads the authoritative snapshot; never reuses a prior project id. */
  public async retry(): Promise<void> {
    await this.#applyAvailability(
      this.dependencies.projectContext.getCurrent(),
      true,
    );
  }

  async #applyAvailability(
    availability: CompatibilityProjectAvailability,
    force = false,
  ): Promise<void> {
    if (
      !force &&
      availability.status === "ready" &&
      this.#contextGeneration === availability.generation &&
      this.#currentProjectId === availability.projectId
    ) {
      return;
    }

    this.#contextGeneration = availability.generation;
    this.#currentProjectId =
      availability.status === "ready" ? availability.projectId : null;

    if (availability.status === "empty") {
      this.#requestId += 1;
      this.#set({ status: "no-projects" });
      return;
    }
    if (availability.status === "unavailable") {
      this.#requestId += 1;
      this.#set({ status: "context-unavailable" });
      return;
    }

    await this.#evaluate(availability.projectId, availability.generation);
  }

  async #evaluate(
    projectId: ProjectId,
    contextGeneration: number,
  ): Promise<void> {
    const requestId = ++this.#requestId;
    this.#set({ status: "loading" });

    const result = await this.dependencies.query.evaluate(projectId);
    if (
      requestId !== this.#requestId ||
      contextGeneration !== this.#contextGeneration ||
      projectId !== this.#currentProjectId
    ) {
      return;
    }

    this.#set(
      result.ok
        ? { status: "ready", report: result.value }
        : stateForError(result.error),
    );
  }

  #set(value: CompatibilityStateValue): void {
    this.#value = value;
    for (const listener of this.#listeners) listener();
  }
}

export const createCompatibilityState = (
  dependencies: CompatibilityStateDependencies,
): CompatibilityState => new CompatibilityState(dependencies);
