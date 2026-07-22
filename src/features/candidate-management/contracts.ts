import type {
  CandidatePart,
  CandidatePartId,
  CandidateProductValues,
  MoneyValue,
  NormalizedAttributes,
  PartCategory,
  Project,
  ProjectId,
  RequestId,
  Result,
  SourcedValue,
  SourceInfo,
  SourceSnapshot,
} from "../../domain/public.js";

/** Management input; optional product and source fields remain intentionally absent when unknown. */
interface CandidateDraftBase {
  readonly projectId: ProjectId;
  readonly product: CandidateProductValues & {
    readonly name: SourcedValue<string>;
  };
  /** Capture may not know source metadata; omission remains distinct from an empty value. */
  readonly sourceInfo?: SourceInfo;
  readonly sourceSnapshot?: SourceSnapshot;
}

/** Keeps the selected category and its normalized attributes coherent before persistence. */
export type CandidateDraft = {
  readonly [Attributes in NormalizedAttributes as Attributes["category"]]: CandidateDraftBase & {
    readonly category: Attributes["category"];
    readonly normalizedAttributes: Attributes;
  };
}[PartCategory];

export interface CreateProjectInput {
  readonly name: string;
}

export interface RenameProjectInput {
  readonly id: ProjectId;
  readonly name: string;
}

export interface UpdateCandidateInput {
  readonly id: CandidatePartId;
  readonly draft: CandidateDraft;
}

export interface MutationContext {
  readonly requestId: RequestId;
  readonly expectedRevision: number;
}

export interface CandidateListQuery {
  readonly projectId: ProjectId;
  readonly category?: PartCategory;
}

export interface ProjectSummary {
  readonly id: ProjectId;
  readonly name: string;
  readonly updatedAt: Project["updatedAt"];
}

export interface CandidateSummary {
  readonly id: CandidatePartId;
  readonly projectId: ProjectId;
  readonly category: PartCategory;
  /** Omitted when the stored candidate predates the required-name feature rule. */
  readonly name?: SourcedValue<string>;
  readonly price?: SourcedValue<MoneyValue>;
  readonly manufacturer?: SourcedValue<string>;
  readonly modelNumber?: SourcedValue<string>;
  /** True when one or more comparison fields remain intentionally unknown. */
  readonly hasMissingDetails: boolean;
  readonly updatedAt: CandidatePart["updatedAt"];
}

/** Errors are normalized by the feature so consumers can choose a recovery action. */
export type ManagementError =
  | {
      readonly kind: "validation";
      readonly fields: Readonly<Record<string, string>>;
    }
  | { readonly kind: "not-found"; readonly entity: "project" | "candidate" }
  | { readonly kind: "conflict" }
  | { readonly kind: "maintenance" }
  | { readonly kind: "storage" }
  | { readonly kind: "quota" }
  | { readonly kind: "unsupported-data" };

export interface CandidateManagementService {
  createProject(
    input: CreateProjectInput,
    context: MutationContext,
  ): Promise<Result<Project, ManagementError>>;
  renameProject(
    input: RenameProjectInput,
    context: MutationContext,
  ): Promise<Result<Project, ManagementError>>;
  deleteProject(
    id: ProjectId,
    context: MutationContext,
  ): Promise<Result<void, ManagementError>>;
  createCandidate(
    input: CandidateDraft,
    context: MutationContext,
  ): Promise<Result<CandidatePart, ManagementError>>;
  updateCandidate(
    input: UpdateCandidateInput,
    context: MutationContext,
  ): Promise<Result<CandidatePart, ManagementError>>;
  deleteCandidate(
    id: CandidatePartId,
    context: MutationContext,
  ): Promise<Result<void, ManagementError>>;
}

export interface CandidateQuery {
  listProjects(): Promise<Result<readonly ProjectSummary[], ManagementError>>;
  listCandidates(
    input: CandidateListQuery,
  ): Promise<Result<readonly CandidateSummary[], ManagementError>>;
  listBuildEligible(
    projectId: ProjectId,
  ): Promise<Result<readonly CandidatePart[], ManagementError>>;
}

/** Public capture boundary for adjacent product-capture features. */
export interface CaptureCandidatePort {
  createCandidate(
    input: CandidateDraft,
  ): Promise<Result<CandidatePart, ManagementError>>;
}
