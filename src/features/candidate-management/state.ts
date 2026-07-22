import type {
  CandidatePartId,
  PartCategory,
  ProjectId,
  Result,
} from "../../domain/public.js";
import type {
  CandidateDraft,
  CandidateManagementService,
  CandidateQuery,
  CandidateSummary,
  ManagementError,
  MutationContext,
  ProjectSummary,
} from "./contracts.js";

export type ManagementDisplayError = { readonly code: ManagementError["kind"] };

export type CandidateEditor =
  | {
      readonly mode: "create";
      readonly projectId: ProjectId;
      readonly draft: CandidateDraft;
    }
  | {
      readonly mode: "edit";
      readonly projectId: ProjectId;
      readonly candidateId: CandidatePartId;
      readonly draft: CandidateDraft;
    };

export type DeletionConfirmation =
  | { readonly kind: "project"; readonly projectId: ProjectId }
  | { readonly kind: "candidate"; readonly candidateId: CandidatePartId };

export interface ManagementStateValue {
  readonly projects: readonly ProjectSummary[];
  readonly candidates: readonly CandidateSummary[];
  readonly selectedProjectId: ProjectId | null;
  readonly selectedCategory: PartCategory | null;
  readonly editor: CandidateEditor | null;
  readonly deletion: DeletionConfirmation | null;
  readonly displayError: ManagementDisplayError | null;
  readonly isLoading: boolean;
  readonly isSaving: boolean;
  readonly mutationsDisabled: boolean;
}

export interface ManagementStateDependencies {
  readonly query: CandidateQuery;
  readonly service: CandidateManagementService;
  readonly createMutationContext: () => MutationContext;
}

const isTerminalReadError = (error: ManagementError): boolean =>
  error.kind === "storage" ||
  error.kind === "quota" ||
  error.kind === "unsupported-data";

const displayError = (error: ManagementError): ManagementDisplayError => ({
  code: error.kind,
});

/** Framework-independent UI state; persistence is accessed only through feature ports. */
export class ManagementState {
  #value: ManagementStateValue = {
    projects: [],
    candidates: [],
    selectedProjectId: null,
    selectedCategory: null,
    editor: null,
    deletion: null,
    displayError: null,
    isLoading: false,
    isSaving: false,
    mutationsDisabled: false,
  };

  public constructor(
    private readonly dependencies: ManagementStateDependencies,
  ) {}

  public get value(): ManagementStateValue {
    return this.#value;
  }

  public async load(): Promise<void> {
    this.#set({ isLoading: true, displayError: null });
    const projects = await this.dependencies.query.listProjects();
    if (!projects.ok) {
      this.#readFailure(projects.error);
      return;
    }

    const selectedProjectId =
      this.#value.selectedProjectId !== null &&
      projects.value.some(
        (project) => project.id === this.#value.selectedProjectId,
      )
        ? this.#value.selectedProjectId
        : (projects.value[0]?.id ?? null);
    const candidates = await this.#loadCandidates(
      selectedProjectId,
      this.#value.selectedCategory,
    );
    if (!candidates.ok) {
      this.#readFailure(candidates.error);
      return;
    }
    this.#set({
      projects: projects.value,
      candidates: candidates.value,
      selectedProjectId,
      isLoading: false,
      displayError: null,
      mutationsDisabled: false,
    });
  }

  public async selectProject(projectId: ProjectId): Promise<void> {
    if (this.#value.mutationsDisabled) return;
    const candidates = await this.#loadCandidates(
      projectId,
      this.#value.selectedCategory,
    );
    if (!candidates.ok) {
      this.#readFailure(candidates.error);
      return;
    }
    this.#set({
      selectedProjectId: projectId,
      candidates: candidates.value,
      displayError: null,
    });
  }

  public async selectCategory(category: PartCategory | null): Promise<void> {
    if (this.#value.selectedProjectId === null || this.#value.mutationsDisabled)
      return;
    const candidates = await this.#loadCandidates(
      this.#value.selectedProjectId,
      category,
    );
    if (!candidates.ok) {
      this.#readFailure(candidates.error);
      return;
    }
    this.#set({
      selectedCategory: category,
      candidates: candidates.value,
      displayError: null,
    });
  }

  public beginCreate(draft: CandidateDraft): void {
    if (this.#value.mutationsDisabled) return;
    this.#set({
      editor: { mode: "create", projectId: draft.projectId, draft },
      displayError: null,
    });
  }

  public beginEdit(candidateId: CandidatePartId, draft: CandidateDraft): void {
    if (this.#value.mutationsDisabled) return;
    this.#set({
      editor: { mode: "edit", projectId: draft.projectId, candidateId, draft },
      displayError: null,
    });
  }

  public requestDeletion(deletion: DeletionConfirmation): void {
    if (this.#value.mutationsDisabled) return;
    this.#set({ deletion, displayError: null });
  }

  public cancelDeletion(): void {
    this.#set({ deletion: null });
  }

  public async saveEditor(): Promise<void> {
    const editor = this.#value.editor;
    if (
      editor === null ||
      this.#value.isSaving ||
      this.#value.mutationsDisabled
    )
      return;
    this.#set({ isSaving: true, displayError: null });
    const context = this.dependencies.createMutationContext();
    const result =
      editor.mode === "create"
        ? await this.dependencies.service.createCandidate(editor.draft, context)
        : await this.dependencies.service.updateCandidate(
            { id: editor.candidateId, draft: editor.draft },
            context,
          );
    if (!result.ok) {
      this.#set({ isSaving: false, displayError: displayError(result.error) });
      return;
    }
    this.#set({ editor: null, isSaving: false });
    await this.load();
  }

  public async confirmDeletion(): Promise<void> {
    const deletion = this.#value.deletion;
    if (
      deletion === null ||
      this.#value.isSaving ||
      this.#value.mutationsDisabled
    )
      return;
    this.#set({ isSaving: true, displayError: null });
    const context = this.dependencies.createMutationContext();
    const result =
      deletion.kind === "project"
        ? await this.dependencies.service.deleteProject(
            deletion.projectId,
            context,
          )
        : await this.dependencies.service.deleteCandidate(
            deletion.candidateId,
            context,
          );
    if (!result.ok) {
      this.#set({ isSaving: false, displayError: displayError(result.error) });
      return;
    }
    this.#set({ deletion: null, isSaving: false });
    await this.load();
  }

  async #loadCandidates(
    projectId: ProjectId | null,
    category: PartCategory | null,
  ): Promise<Result<readonly CandidateSummary[], ManagementError>> {
    if (projectId === null) return { ok: true, value: [] };
    return category === null
      ? this.dependencies.query.listCandidates({ projectId })
      : this.dependencies.query.listCandidates({ projectId, category });
  }

  #readFailure(error: ManagementError): void {
    this.#set({
      isLoading: false,
      displayError: displayError(error),
      mutationsDisabled: isTerminalReadError(error),
    });
  }

  #set(update: Partial<ManagementStateValue>): void {
    this.#value = { ...this.#value, ...update };
  }
}

export const createManagementState = (
  dependencies: ManagementStateDependencies,
): ManagementState => new ManagementState(dependencies);
