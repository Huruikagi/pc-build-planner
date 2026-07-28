import type {
  ActivationId,
  FeatureActivationIntent,
  TargetTabId,
  TransientSurfaceError,
} from "../../application-shell/public.js";
import type { CandidatePartId, ProjectId } from "../../domain/public.js";
import { createRequestId, type Result } from "../../domain/public.js";
import type {
  CaptureError,
  CaptureResult,
  CaptureSessionState,
} from "./contracts.js";
import type { CaptureCoordinator } from "./coordinator.js";

export interface CaptureStateDependencies {
  readonly coordinator: CaptureCoordinator;
  readonly isCurrent: (activationId: ActivationId) => boolean;
  readonly onCaptured?: (
    activationId: ActivationId,
    result: CaptureResult,
  ) => Promise<Result<void, TransientSurfaceError>>;
  readonly retryHandoff?: (
    activationId: ActivationId,
    intent: FeatureActivationIntent,
  ) => Promise<Result<void, TransientSurfaceError>>;
  readonly createRequestId?: () => string;
}

/** Kept for the legacy mapper module until task 5.2 removes that module. */
export interface CaptureSubmitOutcome {
  readonly candidateId: CandidatePartId;
  readonly projectId: ProjectId;
}

const isRecoverableExecutionError = (error: CaptureError): boolean =>
  error.kind !== "permission-lost" &&
  error.kind !== "restricted-page" &&
  error.kind !== "tab-changed";

export class CaptureState {
  #listeners = new Set<() => void>();
  #value: CaptureSessionState | null = null;
  #requestGeneration = 0;

  public constructor(private readonly dependencies: CaptureStateDependencies) {}

  public get value(): CaptureSessionState | null {
    return this.#value;
  }

  public activate(activationId: ActivationId, tabId: TargetTabId): void {
    this.#requestGeneration += 1;
    this.#set({ status: "idle", activationId, tabId });
  }

  public deactivate(): void {
    this.#requestGeneration += 1;
    this.#value = null;
    this.#notify();
  }

  public subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  public async startCapture(): Promise<void> {
    const current = this.#value;
    if (current === null || current.status === "extracting") return;
    if (!this.dependencies.isCurrent(current.activationId)) return;

    if (current.status === "failed" && current.failure.kind === "handoff") {
      await this.#retryRetainedHandoff(current);
      return;
    }

    const generation = ++this.#requestGeneration;
    const requestId = (this.dependencies.createRequestId ?? createRequestId)();
    this.#set({
      status: "extracting",
      activationId: current.activationId,
      tabId: current.tabId,
      requestId,
    });

    let result: Result<CaptureResult, CaptureError>;
    try {
      result = await this.dependencies.coordinator.captureTab(current.tabId);
    } catch {
      result = { ok: false, error: { kind: "injection-failed" } };
    }
    if (!this.#accepts(generation, current.activationId)) return;
    if (!result.ok) {
      this.#set({
        status: "failed",
        activationId: current.activationId,
        tabId: current.tabId,
        failure: {
          kind: "execution",
          error: result.error,
          recoverable: isRecoverableExecutionError(result.error),
        },
      });
      return;
    }

    const handoff = this.dependencies.onCaptured;
    if (handoff === undefined) {
      this.#set({
        status: "idle",
        activationId: current.activationId,
        tabId: current.tabId,
      });
      return;
    }
    const concluded = await handoff(current.activationId, result.value);
    if (!this.#accepts(generation, current.activationId)) return;
    if (!concluded.ok) {
      this.#set({
        status: "failed",
        activationId: current.activationId,
        tabId: current.tabId,
        failure: {
          kind: "execution",
          error: { kind: "injection-failed" },
          recoverable: true,
        },
      });
    }
  }

  public retainHandoffFailure(
    error: TransientSurfaceError,
    intent: FeatureActivationIntent,
  ): void {
    const current = this.#value;
    if (current === null || !this.dependencies.isCurrent(current.activationId))
      return;
    this.#set({
      status: "failed",
      activationId: current.activationId,
      tabId: current.tabId,
      failure: { kind: "handoff", error, retainedIntent: intent },
    });
  }

  async #retryRetainedHandoff(
    current: Extract<CaptureSessionState, { status: "failed" }>,
  ): Promise<void> {
    if (
      current.failure.kind !== "handoff" ||
      this.dependencies.retryHandoff === undefined
    )
      return;
    const generation = ++this.#requestGeneration;
    const result = await this.dependencies.retryHandoff(
      current.activationId,
      current.failure.retainedIntent,
    );
    if (!this.#accepts(generation, current.activationId)) return;
    if (result.ok) {
      this.deactivate();
      return;
    }
    this.#set({
      ...current,
      failure: { ...current.failure, error: result.error },
    });
  }

  #accepts(generation: number, activationId: ActivationId): boolean {
    return (
      generation === this.#requestGeneration &&
      this.dependencies.isCurrent(activationId)
    );
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }

  #set(next: CaptureSessionState): void {
    this.#value = next;
    this.#notify();
  }
}

export const createCaptureState = (
  dependencies: CaptureStateDependencies,
): CaptureState => new CaptureState(dependencies);
