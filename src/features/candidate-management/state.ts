import type { OperationPolicy } from "../../application-shell/public.js";
import type {
  CandidatePartId,
  CandidateSource,
  CandidateSourceId,
  CandidateSourceState,
  PartCategory,
  ProjectId,
} from "../../domain/public.js";
import type {
  CandidateDraft,
  CandidateManagementQuery,
  CandidateManagementService,
  CandidateSummary,
  ManagementError,
  MutationContext,
  ProjectSummary,
  UnresolvedCandidateEditorPrefill,
} from "./contracts.js";
import {
  type CandidateSourceRuleError,
  candidateSourcePolicy,
} from "./source-collection.js";
import type {
  SourcePageOpenError,
  SourcePagePort,
} from "./source-page-port.js";

export type ManagementDisplayError = {
  readonly code: ManagementError["kind"] | "snapshot-restore-failed";
};

/** Draft-relative field key to failure reason, used to mark the offending input. */
export type ManagementFieldErrors = Readonly<Record<string, string>>;

/** Used only until the shell supplies its gate at mount time. */
const allowAllOperations: OperationPolicy = {
  isAllowed: () => true,
  subscribe: () => () => {},
};

const emptyFieldErrors: ManagementFieldErrors = Object.freeze({});

/**
 * A new candidate starts uncategorized with no confirmed values, so missing
 * product information is never invented on the user's behalf.
 */
export const emptyDraft = (projectId: ProjectId): CandidateDraft => ({
  projectId,
  category: "uncategorized",
  product: { name: { original: null, confirmed: "" } },
  normalizedAttributes: { category: "uncategorized" },
});

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

export type PendingPreEdit = UnresolvedCandidateEditorPrefill;

export interface CandidatePreEditState {
  readonly pendingPreEdit: PendingPreEdit | null;
}

export interface ManagementStateValue extends CandidatePreEditState {
  readonly projects: readonly ProjectSummary[];
  readonly candidates: readonly CandidateSummary[];
  readonly selectedProjectId: ProjectId | null;
  readonly selectedCategory: PartCategory | null;
  readonly editor: CandidateEditor | null;
  readonly deletion: DeletionConfirmation | null;
  readonly displayError: ManagementDisplayError | null;
  readonly fieldErrors: ManagementFieldErrors;
  readonly sourceOperationError: CandidateSourceRuleError | null;
  readonly sourceOpenError: SourcePageOpenError | null;
  readonly isLoading: boolean;
  readonly isSaving: boolean;
  readonly mutationsDisabled: boolean;
}

export interface ManagementStateDependencies {
  readonly query: CandidateManagementQuery;
  readonly service: CandidateManagementService;
  /** May resolve asynchronously so the expected revision is read per mutation. */
  readonly createMutationContext: () =>
    | MutationContext
    | Promise<MutationContext>;
  /** Shell-owned gate; mutations stay unavailable while the shell forbids them. */
  readonly operationPolicy?: OperationPolicy;
  readonly sourcePage?: SourcePagePort;
}

const isTerminalReadError = (error: ManagementError): boolean =>
  error.kind === "storage" ||
  error.kind === "quota" ||
  error.kind === "unsupported-data";

const displayError = (error: ManagementError): ManagementDisplayError => ({
  code: error.kind,
});

const fieldErrorsOf = (error: ManagementError): ManagementFieldErrors =>
  error.kind === "validation" ? error.fields : emptyFieldErrors;

/** Framework-independent UI state; persistence is accessed only through feature ports. */
export class ManagementState {
  #allCandidates: readonly CandidateSummary[] = [];
  #listeners = new Set<() => void>();
  #readBlocked = false;
  #value: ManagementStateValue = {
    projects: [],
    candidates: [],
    selectedProjectId: null,
    selectedCategory: null,
    editor: null,
    pendingPreEdit: null,
    deletion: null,
    displayError: null,
    fieldErrors: emptyFieldErrors,
    sourceOperationError: null,
    sourceOpenError: null,
    isLoading: false,
    isSaving: false,
    mutationsDisabled: false,
  };

  public constructor(
    private readonly dependencies: ManagementStateDependencies,
  ) {}

  #mountedPolicy: OperationPolicy | null = null;
  #unsubscribePolicy: (() => void) | undefined;

  get #policy(): OperationPolicy {
    return (
      this.#mountedPolicy ??
      this.dependencies.operationPolicy ??
      allowAllOperations
    );
  }

  /**
   * The shell owns the gate and supplies it per mount. The shell does not
   * remount features on a maintenance transition, so the policy is subscribed
   * rather than read once.
   */
  public attachOperationPolicy(policy: OperationPolicy): void {
    this.releaseOperationPolicy();
    this.#mountedPolicy = policy;
    this.#unsubscribePolicy = policy.subscribe(() => {
      this.#set({ mutationsDisabled: this.#mutationsDisabled() });
    });
    this.#set({ mutationsDisabled: this.#mutationsDisabled() });
  }

  /** Detaches from the shell gate exactly once when the feature unmounts. */
  public releaseOperationPolicy(): void {
    const owned = this.#unsubscribePolicy;
    this.#unsubscribePolicy = undefined;
    try {
      owned?.();
    } catch {
      // Detaching from the shell gate is best-effort at unmount.
    }
  }

  #mutationsDisabled(): boolean {
    if (this.#readBlocked) return true;
    try {
      return !this.#policy.isAllowed("mutation");
    } catch {
      return true;
    }
  }

  /** A pure snapshot; gate transitions arrive through the policy subscription. */
  public get value(): ManagementStateValue {
    return this.#value;
  }

  /** Lets the React adapter observe feature-owned state without owning it. */
  public subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      this.#listeners.delete(listener);
    };
  }

  /**
   * Drops unsaved screen state so a fresh mount starts from the persisted data
   * plus any accepted project-unresolved handoff. The state instance outlives
   * a capture surface, so pending pre-edit remains available within the panel
   * session; editor and deletion state still restore only through a validated
   * snapshot.
   */
  public resetTransientState(): void {
    this.#set({
      editor: null,
      deletion: null,
      displayError: null,
      fieldErrors: emptyFieldErrors,
      sourceOperationError: null,
      sourceOpenError: null,
    });
  }

  /** Applies a previously validated feature-local snapshot without persistence. */
  public applySnapshot(snapshot: {
    readonly selectedProjectId: ProjectId | null;
    readonly selectedCategory: PartCategory | null;
    readonly editor: CandidateEditor | null;
    readonly deletion: DeletionConfirmation | null;
    readonly displayError: ManagementDisplayError | null;
  }): void {
    this.#set({
      selectedProjectId: snapshot.selectedProjectId,
      selectedCategory: snapshot.selectedCategory,
      candidates: this.#filterCandidates(
        snapshot.selectedProjectId,
        snapshot.selectedCategory,
      ),
      editor: snapshot.editor,
      deletion: snapshot.deletion,
      displayError: snapshot.displayError,
    });
  }

  /** Keeps persistent data untouched when a shell-provided snapshot is rejected. */
  public rejectSnapshotRestore(): void {
    this.#set({ displayError: { code: "snapshot-restore-failed" } });
  }

  public async load(): Promise<void> {
    this.#set({
      isLoading: true,
      displayError: null,
      fieldErrors: emptyFieldErrors,
    });
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
    this.#readBlocked = false;
    this.#set({
      projects: projects.value,
      candidates: this.#filterCandidates(
        selectedProjectId,
        this.#value.selectedCategory,
      ),
      selectedProjectId,
      isLoading: false,
      displayError: null,
      fieldErrors: emptyFieldErrors,
      mutationsDisabled: this.#mutationsDisabled(),
    });
  }

  public async selectProject(projectId: ProjectId): Promise<void> {
    if (this.#readBlocked) return;
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
    if (this.#value.selectedProjectId === null || this.#readBlocked) return;
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
    if (this.#value.isSaving || this.#mutationsDisabled()) return;
    this.#set({
      isSaving: true,
      displayError: null,
      fieldErrors: emptyFieldErrors,
    });
    const result = await this.dependencies.service.createProject(
      { name },
      await this.dependencies.createMutationContext(),
    );
    if (!result.ok) return this.#mutationFailure(result.error);
    this.#set({ isSaving: false, pendingPreEdit: null });
    await this.load();
  }

  /** Accepts a validated project-unresolved draft into panel-session state. */
  public holdPendingPreEdit(prefill: PendingPreEdit): void {
    this.#set({ pendingPreEdit: prefill });
  }

  /** The user explicitly abandons the held pre-edit without persistence. */
  public cancelPendingPreEdit(): void {
    this.#set({ pendingPreEdit: null });
  }

  /** Called only after a newer pre-edit has been accepted into the editor. */
  public clearPendingPreEditForActivation(): void {
    this.#set({ pendingPreEdit: null });
  }

  public async renameProject(id: ProjectId, name: string): Promise<void> {
    if (this.#value.isSaving || this.#mutationsDisabled()) return;
    this.#set({
      isSaving: true,
      displayError: null,
      fieldErrors: emptyFieldErrors,
    });
    const result = await this.dependencies.service.renameProject(
      { id, name },
      await this.dependencies.createMutationContext(),
    );
    if (!result.ok) return this.#mutationFailure(result.error);
    this.#set({ isSaving: false });
    await this.load();
  }

  public beginCreate(draft: CandidateDraft): void {
    if (this.#mutationsDisabled()) return;
    this.#set({
      editor: { mode: "create", projectId: draft.projectId, draft },
      displayError: null,
      fieldErrors: emptyFieldErrors,
    });
  }

  public beginEdit(candidateId: CandidatePartId, draft: CandidateDraft): void {
    if (this.#mutationsDisabled()) return;
    this.#set({
      editor: { mode: "edit", projectId: draft.projectId, candidateId, draft },
      displayError: null,
      fieldErrors: emptyFieldErrors,
    });
  }

  /** UI entry point: opens a blank draft for the currently selected project. */
  public startCreate(): void {
    const projectId = this.#value.selectedProjectId;
    if (projectId === null || this.#mutationsDisabled()) return;
    this.beginCreate(emptyDraft(projectId));
  }

  /**
   * UI entry point: restores the full stored draft before opening the editor,
   * because a `CandidateSummary` cannot reconstruct attributes or source data.
   */
  public async startEdit(candidateId: CandidatePartId): Promise<void> {
    if (this.#mutationsDisabled()) return;
    const draft = await this.dependencies.query.getCandidateDraft(candidateId);
    if (!draft.ok) {
      this.#set({
        displayError: displayError(draft.error),
        fieldErrors: fieldErrorsOf(draft.error),
      });
      return;
    }
    this.beginEdit(candidateId, draft.value);
  }

  public updateEditorDraft(draft: CandidateDraft): void {
    const editor = this.#value.editor;
    if (editor === null || this.#mutationsDisabled()) return;
    this.#set({ editor: { ...editor, projectId: draft.projectId, draft } });
  }

  #editorSourceState(): CandidateSourceState | null {
    const editor = this.#value.editor;
    if (editor === null) return null;
    const sources = editor.draft.sources ?? [];
    return sources.length === 0
      ? { sources: [] }
      : {
          sources: sources as [CandidateSource, ...CandidateSource[]],
          primarySourceId: editor.draft.primarySourceId as CandidateSourceId,
        };
  }

  #applyEditorSourceState(state: CandidateSourceState): void {
    const editor = this.#value.editor;
    if (editor === null) return;
    const { primarySourceId: _oldPrimarySourceId, ...draftWithoutPrimary } =
      editor.draft;
    const draft = {
      ...draftWithoutPrimary,
      sources: state.sources,
      ...(state.sources.length === 0
        ? {}
        : { primarySourceId: state.primarySourceId }),
    } as CandidateDraft;
    this.#set({
      editor: { ...editor, draft },
      sourceOperationError: null,
    });
  }

  #updateEditorSources(
    operation: (
      state: CandidateSourceState,
    ) => ReturnType<typeof candidateSourcePolicy.add>,
  ): void {
    if (this.#value.isSaving || this.#mutationsDisabled()) return;
    const state = this.#editorSourceState();
    if (state === null) return;
    const result = operation(state);
    if (!result.ok) {
      this.#set({ sourceOperationError: result.error });
      return;
    }
    this.#applyEditorSourceState(result.value);
  }

  public addEditorSource(source: CandidateSource): void {
    this.#updateEditorSources((state) =>
      candidateSourcePolicy.add(state, source),
    );
  }

  public updateEditorSource(source: CandidateSource): void {
    this.#updateEditorSources((state) =>
      candidateSourcePolicy.update(state, source),
    );
  }

  public removeEditorSource(
    sourceId: CandidateSourceId,
    replacementPrimarySourceId?: CandidateSourceId,
  ): void {
    this.#updateEditorSources((state) =>
      candidateSourcePolicy.remove(state, sourceId, replacementPrimarySourceId),
    );
  }

  public setEditorPrimarySource(sourceId: CandidateSourceId): void {
    this.#updateEditorSources((state) =>
      candidateSourcePolicy.setPrimary(state, sourceId),
    );
  }

  public async openSource(url: string): Promise<void> {
    this.#set({ sourceOpenError: null });
    const result = await (this.dependencies.sourcePage?.open(url) ??
      Promise.resolve({
        ok: false as const,
        error: { kind: "runtime-unavailable" as const },
      }));
    this.#set({ sourceOpenError: result.ok ? null : result.error });
  }

  public cancelEditor(): void {
    if (this.#value.isSaving) return;
    this.#set({
      editor: null,
      displayError: null,
      fieldErrors: emptyFieldErrors,
    });
  }

  public requestDeletion(deletion: DeletionConfirmation): void {
    if (this.#mutationsDisabled()) return;
    this.#set({
      deletion,
      displayError: null,
      fieldErrors: emptyFieldErrors,
    });
  }

  public cancelDeletion(): void {
    this.#set({ deletion: null });
  }

  public async saveEditor(): Promise<void> {
    const editor = this.#value.editor;
    if (editor === null || this.#value.isSaving || this.#mutationsDisabled())
      return;
    this.#set({
      isSaving: true,
      displayError: null,
      fieldErrors: emptyFieldErrors,
    });
    const context = await this.dependencies.createMutationContext();
    const result =
      editor.mode === "create"
        ? await this.dependencies.service.createCandidate(editor.draft, context)
        : await this.dependencies.service.updateCandidate(
            { id: editor.candidateId, draft: editor.draft },
            context,
          );
    if (!result.ok) return this.#mutationFailure(result.error);
    this.#set({ editor: null, isSaving: false });
    await this.load();
  }

  public async confirmDeletion(): Promise<void> {
    const deletion = this.#value.deletion;
    if (deletion === null || this.#value.isSaving || this.#mutationsDisabled())
      return;
    this.#set({
      isSaving: true,
      displayError: null,
      fieldErrors: emptyFieldErrors,
    });
    const context = await this.dependencies.createMutationContext();
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
    if (!result.ok) return this.#mutationFailure(result.error);
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

  /** Keeps the draft and the previously loaded list untouched on failure. */
  #mutationFailure(error: ManagementError): void {
    this.#set({
      isSaving: false,
      displayError: displayError(error),
      fieldErrors: fieldErrorsOf(error),
    });
  }

  #readFailure(error: ManagementError): void {
    this.#readBlocked = isTerminalReadError(error);
    this.#set({
      isLoading: false,
      displayError: displayError(error),
      fieldErrors: fieldErrorsOf(error),
      mutationsDisabled: this.#mutationsDisabled(),
    });
  }

  #set(update: Partial<ManagementStateValue>): void {
    this.#value = { ...this.#value, ...update };
    for (const listener of this.#listeners) listener();
  }
}

export const createManagementState = (
  dependencies: ManagementStateDependencies,
): ManagementState => new ManagementState(dependencies);
