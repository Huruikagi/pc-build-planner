import type { ProjectId } from "../../domain/public.js";
import type {
  CompatibilityError,
  CompatibilityQuery,
  CompatibilityReport,
} from "./contracts.js";

export type CompatibilityEmptyReason = "no-build" | "invalid-reference";
export type CompatibilityFailureReason =
  | "corrupt-data"
  | "unsupported-data"
  | "read-failed";

/** Read-only view state; `empty` and `failed` carry the specific error kind so the view can distinguish them. */
export type CompatibilityStateValue =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly report: CompatibilityReport }
  | { readonly status: "empty"; readonly reason: CompatibilityEmptyReason }
  | { readonly status: "failed"; readonly reason: CompatibilityFailureReason };

export interface CompatibilityStateDependencies {
  readonly query: CompatibilityQuery;
}

const stateForError = (error: CompatibilityError): CompatibilityStateValue => {
  switch (error.kind) {
    case "no-build":
      return { status: "empty", reason: "no-build" };
    case "invalid-reference":
      return { status: "empty", reason: "invalid-reference" };
    case "corrupt-data":
      return { status: "failed", reason: "corrupt-data" };
    case "unsupported-data":
      return { status: "failed", reason: "unsupported-data" };
    case "read-failed":
      return { status: "failed", reason: "read-failed" };
  }
};

/**
 * Framework-independent evaluation state. Every `evaluate()` call is assigned
 * a monotonically increasing generation; a completion whose generation no
 * longer matches the latest request is discarded so a slow, superseded
 * evaluation can never overwrite a newer one or resurrect a stale report.
 */
export class CompatibilityState {
  #listeners = new Set<() => void>();
  #generation = 0;
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

  public async evaluate(projectId: ProjectId): Promise<void> {
    const generation = ++this.#generation;
    this.#set({ status: "loading" });

    const result = await this.dependencies.query.evaluate(projectId);
    if (generation !== this.#generation) return;

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
