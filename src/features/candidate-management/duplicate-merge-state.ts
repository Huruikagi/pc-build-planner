import {
  type CandidatePartId,
  PART_CATEGORIES,
  type Result,
  validateAppDataError,
} from "../../domain/public.js";
import {
  decodeWithProfile,
  inspectJsonSafety,
  optionalField,
  plainObject,
  safeBoolean,
  tagged,
  utcTimestamp,
  uuid,
  z,
} from "../../domain/runtime-schema/public.js";
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

export interface DuplicateMergeStateSnapshotCodec {
  capture(value: DuplicateDecisionState): DuplicateMergeStateSnapshot | null;
  restore(
    input: unknown,
  ): Result<DuplicateDecisionState, DuplicateMergeSnapshotError>;
}

const schemaAccepts = (
  schema: Parameters<typeof z.safeParse>[0],
  value: unknown,
) => z.safeParse(schema, value).success;
const categorySchema = z.custom<(typeof PART_CATEGORIES)[number]>((value) =>
  PART_CATEGORIES.includes(value as never),
);
const sourcedStringSchema = z.custom((value) => isSourcedValueSnapshot(value));
const sourcedMoneySchema = z.custom((value) =>
  isSourcedValueSnapshot(value, "money"),
);
const summarySchema = plainObject({
  id: uuid<CandidatePartId>(),
  projectId: uuid(),
  category: categorySchema,
  name: optionalField(sourcedStringSchema),
  primarySource: optionalField(z.custom(isCandidateSourceSnapshot)),
  price: optionalField(sourcedMoneySchema),
  manufacturer: optionalField(sourcedStringSchema),
  modelNumber: optionalField(sourcedStringSchema),
  hasMissingDetails: safeBoolean(),
  updatedAt: utcTimestamp(),
});
const evidenceSchema = plainObject({
  kind: z.custom<"model-number" | "manufacturer-name">(
    (value) => value === "model-number" || value === "manufacturer-name",
  ),
});
const matchShapeSchema = plainObject({
  candidateId: uuid<CandidatePartId>(),
  confidence: z.custom<"high" | "supporting">(
    (value) => value === "high" || value === "supporting",
  ),
  evidence: evidenceSchema,
  summary: summarySchema,
});
const isMatch = (value: unknown): value is DuplicateCandidateMatch => {
  const parsed = z.safeParse(matchShapeSchema, value);
  return parsed.success && parsed.data.summary.id === parsed.data.candidateId;
};
const matchSchema = z.custom<DuplicateCandidateMatch>(isMatch);
const validationErrorSchema = plainObject({
  kind: z.literal("candidate-validation"),
  fields: z.record(z.string(), z.string()),
});
const isCandidateOperationError = (value: unknown): boolean =>
  schemaAccepts(validationErrorSchema, value) || validateAppDataError(value).ok;
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
const simpleRefreshErrorSchema = plainObject({
  kind: z.custom<(typeof refreshSimpleKinds)[number]>((value) =>
    refreshSimpleKinds.includes(value as never),
  ),
});
const isRefreshError = (value: unknown): boolean =>
  schemaAccepts(simpleRefreshErrorSchema, value) ||
  isCandidateOperationError(value);
const staleErrorSchema = plainObject({ kind: z.literal("stale-decision") });
const managementCauseSchema = plainObject({
  kind: z.literal("management"),
  cause: z.custom(isCandidateOperationError),
});
const sourceAddCauseSchema = plainObject({
  kind: z.literal("source-add"),
  cause: z.custom(isCandidateOperationError),
});
const sourceRefreshCauseSchema = plainObject({
  kind: z.literal("source-refresh"),
  cause: z.custom(isRefreshError),
});
const sourceRouteErrorSchema = plainObject({
  kind: z.literal("source-route"),
  cause: z.custom(
    (value) =>
      schemaAccepts(sourceAddCauseSchema, value) ||
      schemaAccepts(sourceRefreshCauseSchema, value),
  ),
});
const isError = (value: unknown): value is DuplicateMergeError =>
  schemaAccepts(staleErrorSchema, value) ||
  schemaAccepts(managementCauseSchema, value) ||
  schemaAccepts(sourceRouteErrorSchema, value);
const matchesDraftProject = (
  matches: readonly DuplicateCandidateMatch[],
  draft: CandidateDraft,
): boolean =>
  matches.every((match) => match.summary.projectId === draft.projectId);

const pendingStateSchema = plainObject({
  status: z.custom<"evaluating" | "committing">(
    (value) => value === "evaluating" || value === "committing",
  ),
  draft: z.custom<CandidateDraft>(isCandidateDraftSnapshot),
});
const decidingStateSchema = plainObject({
  status: z.literal("deciding"),
  draft: z.custom<CandidateDraft>(isCandidateDraftSnapshot),
  matches: z.array(matchSchema),
  selectedCandidateId: optionalField(uuid<CandidatePartId>()),
});
const failedStateSchema = plainObject({
  status: z.literal("failed"),
  draft: z.custom<CandidateDraft>(isCandidateDraftSnapshot),
  matches: z.array(matchSchema),
  error: z.custom<DuplicateMergeError>(isError),
});

const restoredState = (input: unknown): DuplicateDecisionState | undefined => {
  const pending = z.safeParse(pendingStateSchema, input);
  if (pending.success)
    return {
      status: "failed",
      draft: pending.data.draft,
      matches: [],
      error: { kind: "stale-decision" },
    };
  const deciding = z.safeParse(decidingStateSchema, input);
  if (
    deciding.success &&
    matchesDraftProject(deciding.data.matches, deciding.data.draft) &&
    (deciding.data.selectedCandidateId === undefined ||
      deciding.data.matches.some(
        (match) => match.candidateId === deciding.data.selectedCandidateId,
      ))
  )
    return {
      status: "deciding",
      draft: deciding.data.draft,
      matches: deciding.data.matches,
      ...(deciding.data.selectedCandidateId === undefined
        ? {}
        : { selectedCandidateId: deciding.data.selectedCandidateId }),
    };
  const failed = z.safeParse(failedStateSchema, input);
  if (
    failed.success &&
    matchesDraftProject(failed.data.matches, failed.data.draft)
  )
    return {
      status: "failed",
      draft: failed.data.draft,
      matches: failed.data.matches,
      error: failed.data.error,
    };
  return undefined;
};

const invalid = <S extends Parameters<typeof tagged>[0]>(schema: S): S =>
  tagged(schema, "invalid-shape");
const duplicateSnapshotSchema = plainObject({
  version: invalid(z.literal(1)),
  state: invalid(
    z.custom<unknown>((value) => restoredState(value) !== undefined),
  ),
});

export const createDuplicateMergeStateSnapshotCodec =
  (): DuplicateMergeStateSnapshotCodec => ({
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
      if (
        typeof input === "object" &&
        input !== null &&
        "version" in input &&
        input.version !== 1
      )
        return { ok: false, error: { kind: "unsupported-version" } };
      if (!inspectJsonSafety(input).ok)
        return { ok: false, error: { kind: "invalid-shape" } };
      const decoded = decodeWithProfile(duplicateSnapshotSchema, input, {
        toError: (): DuplicateMergeSnapshotError => ({
          kind: "invalid-shape",
        }),
      });
      if (!decoded.ok) return decoded;
      const state = restoredState(decoded.value.state);
      return state === undefined
        ? { ok: false, error: { kind: "invalid-shape" } }
        : { ok: true, value: state };
    },
  });
