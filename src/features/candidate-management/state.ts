import type {
  CandidatePartId,
  PartCategory,
  ProjectId,
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
  #allCandidates: readonly CandidateSummary[] = [];
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
    const candidates = await Promise.all(
      projects.value.map(async (project) =>
        this.dependencies.query.listCandidates({ projectId: project.id }),
      ),
    );
    const failedCandidates = candidates.find((candidate) => !candidate.ok);
    if (failedCandidates !== undefined && !failedCandidates.ok) {
      this.#readFailure(failedCandidates.error);
      return;
    }
    this.#allCandidates = candidates.flatMap((candidate) =>
      candidate.ok ? candidate.value : [],
    );
    this.#set({
      projects: projects.value,
      candidates: this.#filterCandidates(
        selectedProjectId,
        this.#value.selectedCategory,
      ),
      selectedProjectId,
      isLoading: false,
      displayError: null,
      mutationsDisabled: false,
    });
  }

  public async selectProject(projectId: ProjectId): Promise<void> {
    if (this.#value.mutationsDisabled) return;
    this.#set({
      selectedProjectId: projectId,
      candidates: this.#filterCandidates(
        projectId,
        this.#value.selectedCategory,
      ),
      displayError: null,
    });
  }

  public async selectCategory(category: PartCategory | null): Promise<void> {
    if (this.#value.selectedProjectId === null || this.#value.mutationsDisabled)
      return;
    this.#set({
      selectedCategory: category,
      candidates: this.#filterCandidates(
        this.#value.selectedProjectId,
        category,
      ),
      displayError: null,
    });
  }

  public async createProject(name: string): Promise<void> {
    if (this.#value.isSaving || this.#value.mutationsDisabled) return;
    this.#set({ isSaving: true, displayError: null });
    const result = await this.dependencies.service.createProject(
      { name },
      this.dependencies.createMutationContext(),
    );
    if (!result.ok) {
      this.#set({ isSaving: false, displayError: displayError(result.error) });
      return;
    }
    this.#set({ isSaving: false });
    await this.load();
  }

  public async renameProject(id: ProjectId, name: string): Promise<void> {
    if (this.#value.isSaving || this.#value.mutationsDisabled) return;
    this.#set({ isSaving: true, displayError: null });
    const result = await this.dependencies.service.renameProject(
      { id, name },
      this.dependencies.createMutationContext(),
    );
    if (!result.ok) {
      this.#set({ isSaving: false, displayError: displayError(result.error) });
      return;
    }
    this.#set({ isSaving: false });
    await this.load();
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

  public updateEditorDraft(draft: CandidateDraft): void {
    const editor = this.#value.editor;
    if (editor === null || this.#value.mutationsDisabled) return;
    this.#set({ editor: { ...editor, projectId: draft.projectId, draft } });
  }

  public cancelEditor(): void {
    if (this.#value.isSaving) return;
    this.#set({ editor: null, displayError: null });
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

  public hasCandidateReference(
    candidateId: CandidatePartId,
    projectId: ProjectId,
  ): boolean {
    return this.#allCandidates.some(
      (candidate) =>
        candidate.id === candidateId && candidate.projectId === projectId,
    );
  }

  #filterCandidates(
    projectId: ProjectId | null,
    category: PartCategory | null,
  ): readonly CandidateSummary[] {
    if (projectId === null) return [];
    return this.#allCandidates.filter(
      (candidate) =>
        candidate.projectId === projectId &&
        (category === null || candidate.category === category),
    );
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
