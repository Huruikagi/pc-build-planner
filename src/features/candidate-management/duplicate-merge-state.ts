import {
  type CandidatePartId,
  PART_CATEGORIES,
  type Result,
} from "../../domain/public.js";
import type { CandidateDraft, MutationContext } from "./contracts.js";
import type { DuplicateCandidateMatch } from "./duplicate-matcher.js";
import type {
  DuplicateMergeCoordinator,
  DuplicateMergeError,
  DuplicateSaveDecision,
} from "./duplicate-merge.js";
import {
  isCandidateDraftSnapshot,
  isCandidateSourceSnapshot,
  isSourcedValueSnapshot,
} from "./state-snapshot.js";

export type DuplicateDecisionState =
  | { readonly status: "idle" }
  | { readonly status: "evaluating"; readonly draft: CandidateDraft }
  | {
      readonly status: "deciding";
      readonly draft: CandidateDraft;
      readonly matches: readonly DuplicateCandidateMatch[];
      readonly selectedCandidateId?: CandidatePartId;
    }
  | {
      readonly status: "committing";
      readonly draft: CandidateDraft;
      readonly decision: DuplicateSaveDecision;
    }
  | {
      readonly status: "failed";
      readonly draft: CandidateDraft;
      readonly matches: readonly DuplicateCandidateMatch[];
      readonly error: DuplicateMergeError;
    };

export interface DuplicateMergeStateDependencies {
  readonly coordinator: DuplicateMergeCoordinator;
  readonly createMutationContext: () =>
    | MutationContext
    | Promise<MutationContext>;
  /** Parent editor closes and reloads only through this successful callback. */
  readonly onCommitted: () => void | Promise<void>;
}

export interface DuplicateMergeState {
  readonly value: DuplicateDecisionState;
  subscribe(listener: () => void): () => void;
  evaluate(draft: CandidateDraft): Promise<void>;
  selectCandidate(candidateId: CandidatePartId): boolean;
  mergeSelected(): Promise<void>;
  saveNew(): Promise<void>;
  retry(): Promise<void>;
  cancel(): void;
  restore(value: DuplicateDecisionState): void;
}

class DefaultDuplicateMergeState implements DuplicateMergeState {
  #value: DuplicateDecisionState = { status: "idle" };
  readonly #listeners = new Set<() => void>();

  public constructor(
    private readonly dependencies: DuplicateMergeStateDependencies,
  ) {}

  public get value(): DuplicateDecisionState {
    return this.#value;
  }

  public subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #set(value: DuplicateDecisionState): void {
    this.#value = value;
    for (const listener of this.#listeners) listener();
  }

  public async evaluate(draft: CandidateDraft): Promise<void> {
    if (
      this.#value.status === "evaluating" ||
      this.#value.status === "committing"
    )
      return;
    this.#set({ status: "evaluating", draft });
    const context = await this.dependencies.createMutationContext();
    const beforeEvaluation = this.#value as DuplicateDecisionState;
    if (
      beforeEvaluation.status !== "evaluating" ||
      beforeEvaluation.draft !== draft
    )
      return;
    const result = await this.dependencies.coordinator.evaluate(draft, context);
    const afterEvaluation = this.#value as DuplicateDecisionState;
    if (
      afterEvaluation.status !== "evaluating" ||
      afterEvaluation.draft !== draft
    )
      return;
    if (!result.ok) {
      this.#set({ status: "failed", draft, matches: [], error: result.error });
      return;
    }
    if (result.value.kind === "decision-required") {
      this.#set({
        status: "deciding",
        draft,
        matches: result.value.matches,
      });
      return;
    }
    this.#set({ status: "idle" });
    await this.dependencies.onCommitted();
  }

  public selectCandidate(candidateId: CandidatePartId): boolean {
    if (
      this.#value.status !== "deciding" ||
      !this.#value.matches.some((match) => match.candidateId === candidateId)
    )
      return false;
    this.#set({ ...this.#value, selectedCandidateId: candidateId });
    return true;
  }

  public async mergeSelected(): Promise<void> {
    if (
      this.#value.status !== "deciding" ||
      this.#value.selectedCandidateId === undefined
    )
      return;
    await this.#complete({
      kind: "merge",
      candidateId: this.#value.selectedCandidateId,
    });
  }

  public async saveNew(): Promise<void> {
    if (this.#value.status !== "deciding" && this.#value.status !== "failed")
      return;
    await this.#complete({ kind: "save-new" });
  }

  async #complete(decision: DuplicateSaveDecision): Promise<void> {
    const current = this.#value;
    if (current.status !== "deciding" && current.status !== "failed") return;
    const { draft, matches } = current;
    this.#set({ status: "committing", draft, decision });
    const context = await this.dependencies.createMutationContext();
    if (this.#value.status !== "committing" || this.#value.draft !== draft)
      return;
    const result = await this.dependencies.coordinator.complete(
      draft,
      matches,
      decision,
      context,
    );
    if (this.#value.status !== "committing" || this.#value.draft !== draft)
      return;
    if (!result.ok) {
      this.#set({ status: "failed", draft, matches, error: result.error });
      return;
    }
    this.#set({ status: "idle" });
    await this.dependencies.onCommitted();
  }

  public async retry(): Promise<void> {
    if (this.#value.status !== "failed") return;
    await this.evaluate(this.#value.draft);
  }

  public cancel(): void {
    if (
      this.#value.status === "evaluating" ||
      this.#value.status === "committing"
    )
      return;
    this.#set({ status: "idle" });
  }

  public restore(value: DuplicateDecisionState): void {
    this.#set(value);
  }
}

export const createDuplicateMergeState = (
  dependencies: DuplicateMergeStateDependencies,
): DuplicateMergeState => new DefaultDuplicateMergeState(dependencies);

export interface DuplicateMergeStateSnapshot {
  readonly version: 1;
  readonly state:
    | Extract<DuplicateDecisionState, { status: "deciding" | "failed" }>
    | { readonly status: "evaluating"; readonly draft: CandidateDraft }
    | { readonly status: "committing"; readonly draft: CandidateDraft };
}

export type DuplicateMergeSnapshotError =
  | { readonly kind: "invalid-shape" }
  | { readonly kind: "unsupported-version" };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);
const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key)) &&
  keys.every((key) => key in value);
const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
const isUtcTimestamp = (value: unknown): value is string => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  )
    return false;
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString().replace(".000Z", "Z") ===
      value.replace(".000Z", "Z")
  );
};
const isSummary = (value: unknown): boolean => {
  if (
    !isRecord(value) ||
    !Object.keys(value).every((key) =>
      [
        "id",
        "projectId",
        "category",
        "name",
        "primarySource",
        "price",
        "manufacturer",
        "modelNumber",
        "hasMissingDetails",
        "updatedAt",
      ].includes(key),
    ) ||
    !["id", "projectId", "category", "hasMissingDetails", "updatedAt"].every(
      (key) => key in value,
    )
  )
    return false;
  return (
    isUuid(value.id) &&
    isUuid(value.projectId) &&
    typeof value.category === "string" &&
    PART_CATEGORIES.includes(value.category as never) &&
    (!("name" in value) || isSourcedValueSnapshot(value.name)) &&
    (!("manufacturer" in value) ||
      isSourcedValueSnapshot(value.manufacturer)) &&
    (!("modelNumber" in value) || isSourcedValueSnapshot(value.modelNumber)) &&
    (!("primarySource" in value) ||
      isCandidateSourceSnapshot(value.primarySource)) &&
    (!("price" in value) || isSourcedValueSnapshot(value.price, "money")) &&
    typeof value.hasMissingDetails === "boolean" &&
    isUtcTimestamp(value.updatedAt)
  );
};
const isMatch = (value: unknown): value is DuplicateCandidateMatch =>
  isRecord(value) &&
  hasOnlyKeys(value, ["candidateId", "confidence", "evidence", "summary"]) &&
  isUuid(value.candidateId) &&
  (value.confidence === "high" || value.confidence === "supporting") &&
  isRecord(value.evidence) &&
  hasOnlyKeys(value.evidence, ["kind"]) &&
  (value.evidence.kind === "model-number" ||
    value.evidence.kind === "manufacturer-name") &&
  isSummary(value.summary) &&
  (value.summary as { id: unknown }).id === value.candidateId;
const isStringRecord = (value: unknown): boolean =>
  isRecord(value) &&
  Object.values(value).every((item) => typeof item === "string");
const isManagementError = (value: unknown): boolean => {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "validation")
    return (
      hasOnlyKeys(value, ["kind", "fields"]) && isStringRecord(value.fields)
    );
  if (value.kind === "not-found")
    return (
      hasOnlyKeys(value, ["kind", "entity"]) &&
      ["project", "candidate", "source"].includes(value.entity as string)
    );
  return (
    [
      "conflict",
      "maintenance",
      "storage",
      "quota",
      "unsupported-data",
    ].includes(value.kind) && hasOnlyKeys(value, ["kind"])
  );
};
const refreshSimpleKinds = [
  "invalid-url",
  "no-match",
  "ambiguous-match",
  "ineligible-source",
  "price-unavailable",
  "stale-activation",
  "stale-target",
  "unexpected",
  "tab-unavailable",
  "permission-lost",
  "restricted-page",
  "tab-changed",
  "injection-failed",
  "invalid-payload",
] as const;
const isRefreshError = (value: unknown): boolean =>
  isRecord(value) &&
  (refreshSimpleKinds.includes(
    value.kind as (typeof refreshSimpleKinds)[number],
  )
    ? hasOnlyKeys(value, ["kind"])
    : isManagementError(value));
const isError = (value: unknown): value is DuplicateMergeError => {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "stale-decision") return hasOnlyKeys(value, ["kind"]);
  if (value.kind === "management")
    return (
      hasOnlyKeys(value, ["kind", "cause"]) && isManagementError(value.cause)
    );
  if (
    value.kind !== "source-route" ||
    !hasOnlyKeys(value, ["kind", "cause"]) ||
    !isRecord(value.cause)
  )
    return false;
  return (
    (value.cause.kind === "source-add" &&
      hasOnlyKeys(value.cause, ["kind", "cause"]) &&
      isManagementError(value.cause.cause)) ||
    (value.cause.kind === "source-refresh" &&
      hasOnlyKeys(value.cause, ["kind", "cause"]) &&
      isRefreshError(value.cause.cause))
  );
};
const isMatches = (
  value: unknown,
): value is readonly DuplicateCandidateMatch[] =>
  Array.isArray(value) && value.every(isMatch);
const matchesDraftProject = (
  matches: readonly DuplicateCandidateMatch[],
  draft: CandidateDraft,
): boolean =>
  matches.every((match) => match.summary.projectId === draft.projectId);

const restoredState = (input: unknown): DuplicateDecisionState | undefined => {
  if (!isRecord(input) || typeof input.status !== "string") return undefined;
  if (
    (input.status === "evaluating" || input.status === "committing") &&
    hasOnlyKeys(input, ["status", "draft"]) &&
    isCandidateDraftSnapshot(input.draft)
  )
    return {
      status: "failed",
      draft: input.draft,
      matches: [],
      error: { kind: "stale-decision" },
    };
  if (
    input.status === "deciding" &&
    isCandidateDraftSnapshot(input.draft) &&
    isMatches(input.matches) &&
    matchesDraftProject(input.matches, input.draft) &&
    Object.keys(input).every((key) =>
      ["status", "draft", "matches", "selectedCandidateId"].includes(key),
    ) &&
    ["status", "draft", "matches"].every((key) => key in input) &&
    (input.selectedCandidateId === undefined ||
      (isUuid(input.selectedCandidateId) &&
        input.matches.some(
          (match) => match.candidateId === input.selectedCandidateId,
        )))
  ) {
    return {
      status: "deciding",
      draft: input.draft,
      matches: input.matches,
      ...(input.selectedCandidateId === undefined
        ? {}
        : {
            selectedCandidateId: input.selectedCandidateId as CandidatePartId,
          }),
    };
  }
  if (
    input.status === "failed" &&
    isCandidateDraftSnapshot(input.draft) &&
    isMatches(input.matches) &&
    matchesDraftProject(input.matches, input.draft) &&
    isError(input.error) &&
    hasOnlyKeys(input, ["status", "draft", "matches", "error"])
  )
    return {
      status: "failed",
      draft: input.draft,
      matches: input.matches,
      error: input.error,
    };
  return undefined;
};

export const createDuplicateMergeStateSnapshotCodec = () => ({
  capture(value: DuplicateDecisionState): DuplicateMergeStateSnapshot | null {
    if (value.status === "idle") return null;
    const state: DuplicateMergeStateSnapshot["state"] =
      value.status === "committing"
        ? { status: "committing", draft: value.draft }
        : value;
    return { version: 1, state };
  },
  restore(
    input: unknown,
  ): Result<DuplicateDecisionState, DuplicateMergeSnapshotError> {
    if (!isRecord(input))
      return { ok: false, error: { kind: "invalid-shape" } };
    if (input.version !== 1)
      return { ok: false, error: { kind: "unsupported-version" } };
    if (!hasOnlyKeys(input, ["version", "state"]))
      return { ok: false, error: { kind: "invalid-shape" } };
    const state = restoredState(input.state);
    return state === undefined
      ? { ok: false, error: { kind: "invalid-shape" } }
      : { ok: true, value: state };
  },
});
