import type {
  ActivationId,
  FeatureActivationIntent,
  TargetTabId,
  TransientSurfaceError,
} from "../../application-shell/public.js";
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
  readonly createHandoffIntent: (
    result: CaptureResult,
  ) => Result<FeatureActivationIntent, CaptureError>;
  readonly createManualIntent?: () => FeatureActivationIntent;
  readonly conclude: (
    activationId: ActivationId,
    intent: FeatureActivationIntent,
  ) => Promise<Result<void, TransientSurfaceError>>;
  readonly createRequestId?: () => string;
}

export interface CaptureRollbackState {
  readonly activationId: ActivationId;
  readonly tabId: TargetTabId;
  readonly requestGeneration: number;
  readonly handoffInFlightGeneration: number | null;
}

const isRecoverableExecutionError = (error: CaptureError): boolean =>
  error.kind !== "permission-lost" &&
  error.kind !== "restricted-page" &&
  error.kind !== "tab-changed" &&
  error.kind !== "no-candidate";

export class CaptureState {
  #listeners = new Set<() => void>();
  #value: CaptureSessionState | null = null;
  #requestGeneration = 0;
  #handoffInFlightGeneration: number | null = null;

  public constructor(private readonly dependencies: CaptureStateDependencies) {}

  public get value(): CaptureSessionState | null {
    return this.#value;
  }

  public activate(activationId: ActivationId, tabId: TargetTabId): void {
    this.#requestGeneration += 1;
    this.#handoffInFlightGeneration = null;
    this.#set({ status: "idle", activationId, tabId });
  }

  public deactivate(): void {
    this.#requestGeneration += 1;
    this.#handoffInFlightGeneration = null;
    this.#value = null;
    this.#notify();
  }

  /** Captures only execution identity needed to continue an in-flight handoff rollback. */
  public captureRollbackState(): CaptureRollbackState | undefined {
    const current = this.#value;
    if (current === null) return undefined;
    return {
      activationId: current.activationId,
      tabId: current.tabId,
      requestGeneration: this.#requestGeneration,
      handoffInFlightGeneration: this.#handoffInFlightGeneration,
    };
  }

  /** Restores the exact generation so the awaiting handoff result is still accepted. */
  public restoreRollbackState(snapshot: CaptureRollbackState): void {
    this.#requestGeneration = snapshot.requestGeneration;
    this.#handoffInFlightGeneration = snapshot.handoffInFlightGeneration;
    this.#set({
      status: "extracting",
      activationId: snapshot.activationId,
      tabId: snapshot.tabId,
      requestId: "rollback",
    });
  }

  public subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  public async startCapture(): Promise<void> {
    const current = this.#value;
    if (current === null || current.status === "extracting") return;
    if (this.#handoffInFlightGeneration !== null) return;
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

    const createIntent = this.dependencies.createHandoffIntent;
    const conclude = this.dependencies.conclude;
    const prepared = createIntent(result.value);
    if (!prepared.ok) {
      this.#set({
        status: "failed",
        activationId: current.activationId,
        tabId: current.tabId,
        failure: {
          kind: "execution",
          error: prepared.error,
          recoverable: isRecoverableExecutionError(prepared.error),
        },
      });
      return;
    }
    const concluded = await conclude(current.activationId, prepared.value);
    if (!this.#accepts(generation, current.activationId)) return;
    if (concluded.ok) {
      this.deactivate();
      return;
    }
    this.#set({
      status: "failed",
      activationId: current.activationId,
      tabId: current.tabId,
      failure: {
        kind: "handoff",
        error: concluded.error,
        retainedIntent: prepared.value,
      },
    });
  }

  public async startManualEntry(): Promise<void> {
    const current = this.#value;
    if (
      current === null ||
      current.status !== "failed" ||
      current.failure.kind !== "execution" ||
      current.failure.error.kind !== "no-candidate" ||
      this.dependencies.createManualIntent === undefined ||
      this.#handoffInFlightGeneration !== null ||
      !this.dependencies.isCurrent(current.activationId)
    )
      return;
    const intent = this.dependencies.createManualIntent();
    const generation = ++this.#requestGeneration;
    this.#handoffInFlightGeneration = generation;
    const concluded = await this.dependencies.conclude(
      current.activationId,
      intent,
    );
    if (this.#handoffInFlightGeneration === generation) {
      this.#handoffInFlightGeneration = null;
    }
    if (!this.#accepts(generation, current.activationId)) return;
    if (concluded.ok) {
      this.deactivate();
      return;
    }
    this.#set({
      status: "failed",
      activationId: current.activationId,
      tabId: current.tabId,
      failure: {
        kind: "handoff",
        error: concluded.error,
        retainedIntent: intent,
      },
    });
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
    if (current.failure.kind !== "handoff") return;
    const generation = ++this.#requestGeneration;
    this.#handoffInFlightGeneration = generation;
    const result = await this.dependencies.conclude(
      current.activationId,
      current.failure.retainedIntent,
    );
    if (this.#handoffInFlightGeneration === generation) {
      this.#handoffInFlightGeneration = null;
    }
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
