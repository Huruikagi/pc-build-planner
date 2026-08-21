import type {
  AppDataError,
  CandidatePart,
  CandidatePartId,
  CandidateProductValues,
  CandidateSource,
  CandidateSourceId,
  CandidateSourceKind,
  NormalizedAttributes,
  PartCategory,
  ProjectId,
  RequestId,
  Result,
  SourcedValue,
  SourceSnapshot,
} from "../../domain/public.js";

/** Management input; optional product and source fields remain intentionally absent when unknown. */
interface CandidateDraftBase {
  readonly projectId: ProjectId;
  readonly product: CandidateProductValues & {
    readonly name: SourcedValue<string>;
  };
  /** Omission in an unsaved manual draft is normalized to an empty collection. */
  readonly sources?: readonly CandidateSource[];
  readonly primarySourceId?: CandidateSourceId;
  readonly sourceSnapshot?: SourceSnapshot;
}

/** Keeps the selected category and its normalized attributes coherent before persistence. */
export type CandidateDraft = {
  readonly [Attributes in NormalizedAttributes as Attributes["category"]]: CandidateDraftBase & {
    readonly category: Attributes["category"];
    readonly normalizedAttributes: Attributes;
  };
}[PartCategory];

/** Editing-start draft whose project is intentionally unresolved. */
export type UnresolvedCandidateDraft = {
  readonly [Attributes in NormalizedAttributes as Attributes["category"]]: Omit<
    CandidateDraftBase,
    "projectId"
  > & {
    readonly category: Attributes["category"];
    readonly normalizedAttributes: Attributes;
  };
}[PartCategory];

export interface UnresolvedCandidateEditorPrefill {
  readonly draft: UnresolvedCandidateDraft;
  readonly categoryHint?: PartCategory;
  /** Closed diagnostics from an untrusted capture; never persisted with the draft. */
  readonly captureDiagnostics?: readonly CaptureDiagnostic[];
}

/**
 * Save-target authority for a pre-edit. `unresolved` covers both "no current
 * selection" and "context unavailable": neither is an error, and neither may
 * be replaced by a catalog head or a payload-supplied project.
 */
export type CurrentProjectResolution =
  | { readonly status: "resolved"; readonly projectId: ProjectId }
  | { readonly status: "unresolved" };

/**
 * Read-only view of the validated current project. Candidate management never
 * writes the current context, so recovery is observed rather than requested.
 */
export interface CurrentProjectPort {
  getCurrentProject(): CurrentProjectResolution;
  subscribe(listener: () => void): () => void;
  refresh?(): Promise<
    Result<CurrentProjectResolution, { readonly kind: "context-unavailable" }>
  >;
}

/** Candidate-management hooks used by the project-context change guard. */
export interface CandidateProjectDraftGuard {
  isDirty(): boolean;
  discardConfirmedSwitch(from: ProjectId, to: ProjectId): void;
  preserveForcedSwitch(from: ProjectId | null): void;
}

export type CaptureDiagnosticReason =
  | "empty"
  | "too-long"
  | "control-characters"
  | "invalid-format"
  | "unresolvable";

export type CaptureDiagnosticField =
  | "name"
  | "category"
  | "manufacturer"
  | "modelNumber"
  | "price"
  | "url"
  | "specification";

export interface CaptureDiagnostic {
  readonly field: CaptureDiagnosticField;
  readonly reason: CaptureDiagnosticReason;
}

export interface UpdateCandidateInput {
  readonly id: CandidatePartId;
  readonly draft: CandidateDraft;
}

export interface MutationContext {
  readonly requestId: RequestId;
  readonly expectedRevision: number;
}

/** Candidate-owned field validation remains distinct from shared data failures. */
export interface CandidateValidationError {
  readonly kind: "candidate-validation";
  readonly fields: Readonly<Record<string, string>>;
}

/** Candidate operations preserve the foundation-owned AppDataError unchanged. */
export type CandidateOperationError = CandidateValidationError | AppDataError;

/** Minimal create-only capability consumed by the duplicate-product workflow. */
export interface CandidateCreatePort {
  createCandidate(
    input: CandidateDraft,
    context: MutationContext,
  ): Promise<Result<CandidatePart, CandidateOperationError>>;
}

export interface CandidateListQuery {
  readonly projectId: ProjectId;
  readonly category?: PartCategory;
}

export interface ProjectSummary {
  readonly id: ProjectId;
  readonly name: string;
  readonly updatedAt: import("../../domain/public.js").UtcTimestamp;
}

export interface CandidateSummary {
  readonly id: CandidatePartId;
  readonly projectId: ProjectId;
  readonly category: PartCategory;
  /** Omitted when the stored candidate predates the required-name feature rule. */
  readonly name?: SourcedValue<string>;
  readonly primarySource?: CandidateSource;
  readonly price?: CandidateSource["price"];
  readonly manufacturer?: SourcedValue<string>;
  readonly modelNumber?: SourcedValue<string>;
  /** True when one or more comparison fields remain intentionally unknown. */
  readonly hasMissingDetails: boolean;
  readonly updatedAt: CandidatePart["updatedAt"];
}

/** The selected source no longer has the identity observed by the caller. */
export type CandidateSourceMutationError =
  | CandidateOperationError
  | { readonly kind: "precondition-failed" };

export interface CandidateManagementService {
  createCandidate(
    input: CandidateDraft,
    context: MutationContext,
  ): Promise<Result<CandidatePart, CandidateOperationError>>;
  updateCandidate(
    input: UpdateCandidateInput,
    context: MutationContext,
  ): Promise<Result<CandidatePart, CandidateOperationError>>;
  deleteCandidate(
    id: CandidatePartId,
    context: MutationContext,
  ): Promise<Result<void, CandidateOperationError>>;
}

interface CandidateQueryBase {
  listProjects(): Promise<Result<readonly ProjectSummary[], AppDataError>>;
  listCandidates(
    input: CandidateListQuery,
  ): Promise<Result<readonly CandidateSummary[], AppDataError>>;
  listBuildEligible(
    projectId: ProjectId,
  ): Promise<Result<readonly CandidatePart[], AppDataError>>;
}

export interface CandidateQuery extends CandidateQueryBase {
  getCandidateDraft(
    id: CandidatePartId,
  ): Promise<Result<CandidateDraft, AppDataError>>;
}

export interface CandidateManagementQuery extends CandidateQueryBase {
  /**
   * Restores a complete edit draft for a stored candidate.
   * `CandidateSummary` intentionally omits attributes and source metadata, so
   * editing an existing candidate must start from this contract.
   */
  getCandidateDraft(
    id: CandidatePartId,
  ): Promise<Result<CandidateDraft, AppDataError>>;
}

export interface CandidateSourceReference {
  readonly candidateId: CandidatePartId;
  readonly sourceId: CandidateSourceId;
  readonly pageUrl?: string;
  readonly kind?: CandidateSourceKind;
  readonly isPrimary: boolean;
}

export interface CandidateSourceCatalogPort {
  listSourceReferences(input: {
    readonly candidateId?: CandidatePartId;
  }): Promise<Result<readonly CandidateSourceReference[], AppDataError>>;
  getSourceReference(input: {
    readonly candidateId: CandidatePartId;
    readonly sourceId: CandidateSourceId;
  }): Promise<Result<CandidateSourceReference, AppDataError>>;
}

export interface AddCandidateSourceInput {
  readonly candidateId: CandidatePartId;
  readonly source: CandidateSource & { readonly pageUrl: string };
}

export interface UpdateCandidateSourceInput {
  readonly candidateId: CandidatePartId;
  readonly source: CandidateSource;
}

export interface PatchCandidateSourcePriceInput {
  readonly candidateId: CandidatePartId;
  readonly sourceId: CandidateSourceId;
  /** Compared byte-for-byte; URL identity and normalization belong downstream. */
  readonly expectedPageUrl: string;
  readonly expectedKind: "retail";
  readonly price: SourcedValue<import("../../domain/public.js").MoneyValue>;
  readonly capturedAt: import("../../domain/public.js").UtcTimestamp;
}

export interface RemoveCandidateSourceInput {
  readonly candidateId: CandidatePartId;
  readonly sourceId: CandidateSourceId;
  readonly replacementPrimarySourceId?: CandidateSourceId;
}

export interface SetPrimarySourceInput {
  readonly candidateId: CandidatePartId;
  readonly sourceId: CandidateSourceId;
}

export interface CandidateSourceMutationPort {
  addSource(
    input: AddCandidateSourceInput,
  ): Promise<Result<void, CandidateOperationError>>;
  updateSource(
    input: UpdateCandidateSourceInput,
  ): Promise<Result<void, CandidateOperationError>>;
  patchSourcePrice(
    input: PatchCandidateSourcePriceInput,
  ): Promise<Result<void, CandidateSourceMutationError>>;
  removeSource(
    input: RemoveCandidateSourceInput,
  ): Promise<Result<void, CandidateOperationError>>;
  setPrimarySource(
    input: SetPrimarySourceInput,
  ): Promise<Result<void, CandidateOperationError>>;
}

/** Feature-internal mutation contract; public facade supplies the context. */
export interface CandidateSourceService {
  addSource(
    input: AddCandidateSourceInput,
    context: MutationContext,
  ): Promise<Result<CandidatePart, CandidateOperationError>>;
  updateSource(
    input: UpdateCandidateSourceInput,
    context: MutationContext,
  ): Promise<Result<CandidatePart, CandidateOperationError>>;
  patchSourcePrice(
    input: PatchCandidateSourcePriceInput,
    context: MutationContext,
  ): Promise<Result<CandidatePart, CandidateSourceMutationError>>;
  removeSource(
    input: RemoveCandidateSourceInput,
    context: MutationContext,
  ): Promise<Result<CandidatePart, CandidateOperationError>>;
  setPrimarySource(
    input: SetPrimarySourceInput,
    context: MutationContext,
  ): Promise<Result<CandidatePart, CandidateOperationError>>;
}
