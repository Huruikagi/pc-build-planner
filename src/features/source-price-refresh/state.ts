import type {
  ActivationId,
  TargetTabId,
} from "../../application-shell/public.js";
import type { Result } from "../../domain/public.js";
import type {
  SourcePriceRefreshError,
  SourcePriceRefreshReceipt,
  SourcePriceRefreshStateValue,
} from "./contracts.js";

/** The pinned activation generation and tab a single refresh run may touch. */
export interface SourcePriceRefreshWorkflowInput {
  readonly activationId: ActivationId;
  readonly tabId: TargetTabId;
}

export interface SourcePriceRefreshStateDependencies {
  /**
   * Runs the extraction, match and atomic update for one activation. The state
   * owns generations only; the workflow itself is supplied by the feature's
   * use case wiring.
   *
   * Contract: this must always settle with a typed `Result` and never reject.
   * Turning infrastructure failures into `SourcePriceRefreshError` values is the
   * workflow's obligation (`SourcePriceRefreshService`), because only it knows
   * which kind actually occurred — including a port that breaks its own
   * contract by throwing, which the workflow contains as `unexpected`. The state
   * deliberately does not catch: mapping a thrown value here would report a
   * containment the workflow may not actually have performed, and the boundary
   * that owns the ports is the one that can honestly describe them.
   */
  readonly runRefresh: (
    input: SourcePriceRefreshWorkflowInput,
  ) => Promise<Result<SourcePriceRefreshReceipt, SourcePriceRefreshError>>;
  readonly isCurrent: (activationId: ActivationId) => boolean;
}

/**
 * Single rule, taken from the design's error table: a failure is recoverable
 * exactly when the user's way forward ends in re-running the same context menu
 * gesture, and not recoverable when it does not — because something else must
 * be repaired first, or because nothing the user can do makes the same gesture
 * succeed. The table's only non-retry rows are `no-match` (review stored sources)
 * and `ambiguous-match` (de-duplicate stored sources); every other listed row
 * ends in "retry", including `ineligible-source`, whose guidance is to re-run on
 * a retail source rather than to repair anything.
 *
 * Kinds the table does not list are classified under that same rule:
 * `validation` and `unsupported-data` come from the storage layer rejecting the
 * stored shape, so repeating the gesture reproduces them until the stored data
 * is repaired; `invalid-url` and `restricted-page` are the page-side analogue of
 * `ineligible-source` (re-run on an eligible page, nothing stored is broken);
 * the remaining extraction, tab, permission and generation failures are all
 * transient conditions the same gesture can clear. `unexpected` is the one
 * non-recoverable kind that no stored data repair can clear either: an upstream
 * port broke its `Result` contract, which is a deterministic defect in the
 * extension, so the same gesture reproduces it and the rule's "ends in a re-run"
 * test fails.
 */
export const isRecoverableSourcePriceRefreshError = (
  error: SourcePriceRefreshError,
): boolean => {
  switch (error.kind) {
    case "no-match":
    case "ambiguous-match":
    case "validation":
    case "unsupported-data":
    case "unexpected":
      return false;
    case "invalid-url":
    case "ineligible-source":
    case "price-unavailable":
    case "stale-activation":
    case "stale-target":
    case "tab-unavailable":
    case "permission-lost":
    case "restricted-page":
    case "tab-changed":
    case "injection-failed":
    case "invalid-payload":
    case "conflict":
    case "maintenance":
    case "storage":
    case "quota":
      return true;
    default: {
      const exhaustive: never = error;
      return exhaustive;
    }
  }
};

const failure = (
  activationId: ActivationId,
  error: SourcePriceRefreshError,
): SourcePriceRefreshStateValue => ({
  status: "failed",
  activationId,
  error,
  recoverable: isRecoverableSourcePriceRefreshError(error),
});

/**
 * Session-only refresh state for one transient surface. Each accepted
 * activation starts a new generation that immediately reports `running`; a
 * newer generation replaces the previous value, and results from a replaced or
 * unmounted generation are discarded instead of being displayed.
 */
export class SourcePriceRefreshState {
  #listeners = new Set<() => void>();
  #value: SourcePriceRefreshStateValue | null = null;
  #generation = 0;
  #mounted = true;

  public constructor(
    private readonly dependencies: SourcePriceRefreshStateDependencies,
  ) {}

  public get value(): SourcePriceRefreshStateValue | null {
    return this.#value;
  }

  /**
   * Number of live subscriptions. Makes the release performed by `unmount` an
   * observable property rather than an invisible memory effect, so a regression
   * that stopped releasing listeners is detectable.
   */
  public get listenerCount(): number {
    return this.#listeners.size;
  }

  public subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Accepts an activation, shows progress at once and runs the refresh. */
  public async activate(
    activationId: ActivationId,
    tabId: TargetTabId,
  ): Promise<void> {
    if (!this.#mounted) return;
    // Bumped before the currency check on purpose: a rejected activation still
    // replaces the display, so an in-flight run must not resurrect over it.
    const generation = ++this.#generation;
    if (!this.dependencies.isCurrent(activationId)) {
      this.#set(failure(activationId, { kind: "stale-activation" }));
      return;
    }
    this.#set({ status: "running", activationId, tabId });

    const result: Result<SourcePriceRefreshReceipt, SourcePriceRefreshError> =
      await this.dependencies.runRefresh({ activationId, tabId });
    if (!this.#accepts(generation, activationId)) return;
    this.#set(
      result.ok
        ? { status: "succeeded", activationId, receipt: result.value }
        : failure(activationId, result.error),
    );
  }

  /** Drops every listener and the displayed value so nothing is left to retry. */
  public unmount(): void {
    this.#mounted = false;
    this.#value = null;
    this.#listeners.clear();
  }

  #accepts(generation: number, activationId: ActivationId): boolean {
    return (
      this.#mounted &&
      generation === this.#generation &&
      this.dependencies.isCurrent(activationId)
    );
  }

  #set(next: SourcePriceRefreshStateValue): void {
    this.#value = next;
    for (const listener of this.#listeners) listener();
  }
}

export const createSourcePriceRefreshState = (
  dependencies: SourcePriceRefreshStateDependencies,
): SourcePriceRefreshState => new SourcePriceRefreshState(dependencies);
