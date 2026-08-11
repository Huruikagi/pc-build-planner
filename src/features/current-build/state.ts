import type { OperationPolicy } from "../../application-shell/public.js";
import {
  type CandidatePart,
  type CandidatePartId,
  type CurrentBuild,
  createRequestId as createDomainRequestId,
  type PartCategory,
  type ProjectId,
  type RequestId,
  type Revision,
} from "../../domain/public.js";
import type {
  CandidateQuery,
  ProjectSummary,
} from "../candidate-management/public.js";
import type { CategoryPolicy } from "./category-policy.js";
import type {
  BuildCommand,
  BuildError,
  BuildService,
  CurrentBuildQuery,
} from "./contracts.js";
import type {
  BuildProjectAvailability,
  CurrentBuildProjectContextAdapter,
} from "./project-context-adapter.js";
import { managementErrorToBuildError } from "./service.js";

/** 共通contextの読取だけを使う。project選択commandは持ち込まない。 */
export type CurrentBuildProjectContextReadPort = Pick<
  CurrentBuildProjectContextAdapter,
  "getCurrent" | "subscribe"
>;

export type BuildDisplayError = {
  readonly code: BuildError["kind"] | "snapshot-restore-failed";
};

export type BuildFieldErrors = Readonly<Record<string, string>>;

/** Used only until the shell supplies its gate at mount time. */
const allowAllOperations: OperationPolicy = {
  isAllowed: () => true,
  subscribe: () => () => {},
};

const emptyFieldErrors: BuildFieldErrors = Object.freeze({});
const emptyQuantityDrafts: Readonly<Record<string, string>> = Object.freeze({});

export interface BuildStateValue {
  readonly projects: readonly ProjectSummary[];
  /**
   * 共通contextの確定状態の射影。`null` は context 未接続を表し、
   * shell 接続前の legacy mount 経路だけがこの値を取る。
   */
  readonly projectAvailability: BuildProjectAvailability["status"] | null;
  readonly selectedProjectId: ProjectId | null;
  readonly selectedCategory: PartCategory | null;
  readonly candidates: readonly CandidatePart[];
  readonly currentBuild: Readonly<CurrentBuild> | null;
  readonly quantityDrafts: Readonly<Record<string, string>>;
  readonly savingCommand: BuildCommand | null;
  readonly displayError: BuildDisplayError | null;
  readonly fieldErrors: BuildFieldErrors;
  readonly isLoading: boolean;
  readonly isSaving: boolean;
  readonly mutationsDisabled: boolean;
}

export interface BuildStateDependencies {
  readonly candidates: CandidateQuery;
  readonly query: CurrentBuildQuery;
  readonly service: BuildService;
  readonly policy: CategoryPolicy;
  readonly createRequestId?: () => RequestId;
  /** Shell-owned gate; mutations stay unavailable while the shell forbids them. */
  readonly operationPolicy?: OperationPolicy;
}

/**
 * Requirement 5.4 names exactly these three kinds (破損・非対応・利用不能) as
 * disabling further changes until a fresh load succeeds. Quota, maintenance,
 * and conflict are transient — the user can free space, wait, or reload.
 */
const isTerminalError = (error: BuildError): boolean =>
  error.kind === "storage" ||
  error.kind === "unsupported-data" ||
  error.kind === "corrupt-data";

const displayError = (error: BuildError): BuildDisplayError => ({
  code: error.kind,
});

const fieldErrorsOf = (error: BuildError): BuildFieldErrors =>
  error.kind === "validation" ? error.fields : emptyFieldErrors;

const withoutKey = (
  record: Readonly<Record<string, string>>,
  key: string,
): Readonly<Record<string, string>> => {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
};

/** Framework-independent UI state; persistence is accessed only through feature ports. */
export class BuildState {
  #allCandidates: readonly CandidatePart[] = [];
  #listeners = new Set<() => void>();
  #readBlocked = false;
  #revision: Revision = 0 as Revision;
  #context: CurrentBuildProjectContextReadPort | null = null;
  #unsubscribeContext: (() => void) | undefined;
  #contextGeneration: number | null = null;
  #loadSerial = 0;
  #value: BuildStateValue = {
    projects: [],
    projectAvailability: null,
    selectedProjectId: null,
    selectedCategory: null,
    candidates: [],
    currentBuild: null,
    quantityDrafts: emptyQuantityDrafts,
    savingCommand: null,
    displayError: null,
    fieldErrors: emptyFieldErrors,
    isLoading: false,
    isSaving: false,
    mutationsDisabled: false,
  };

  public constructor(private readonly dependencies: BuildStateDependencies) {}

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

  /**
   * Subscribes to the shared current project. From this point the context is
   * the only selection authority: the feature neither falls back to another
   * project nor accepts a screen-driven selection.
   */
  public async attachProjectContext(
    context: CurrentBuildProjectContextReadPort,
  ): Promise<void> {
    this.releaseProjectContext();
    this.#context = context;
    this.#unsubscribeContext = context.subscribe((availability) => {
      void this.#applyAvailability(availability);
    });
    await this.#applyAvailability(context.getCurrent());
  }

  /** Detaches from the shared context exactly once when the feature unmounts. */
  public releaseProjectContext(): void {
    const owned = this.#unsubscribeContext;
    this.#unsubscribeContext = undefined;
    this.#context = null;
    try {
      owned?.();
    } catch {
      // Detaching from the shared context is best-effort at unmount.
    }
  }

  async #applyAvailability(
    availability: BuildProjectAvailability,
  ): Promise<void> {
    this.#contextGeneration = availability.generation;
    if (availability.status !== "ready") {
      // project 固有の状態を解放し、変更操作を止めた理由を表示できる状態にする。
      this.#allCandidates = [];
      this.#revision = 0 as Revision;
      this.#loadSerial += 1;
      // 先に availability を確定させてから変更可否を評価する。
      this.#set({ projectAvailability: availability.status });
      this.#set({
        selectedProjectId: null,
        candidates: [],
        currentBuild: null,
        quantityDrafts: emptyQuantityDrafts,
        savingCommand: null,
        isLoading: false,
        isSaving: false,
        mutationsDisabled: this.#mutationsDisabled(),
      });
      return;
    }
    this.#set({ projectAvailability: "ready" });
    await this.#loadForProject(availability.projectId, availability.generation);
  }

  #mutationsDisabled(): boolean {
    if (this.#readBlocked) return true;
    if (
      this.#value.projectAvailability !== null &&
      this.#value.projectAvailability !== "ready"
    )
      return true;
    try {
      return !this.#policy.isAllowed("mutation");
    } catch {
      return true;
    }
  }

  /** A pure snapshot; gate transitions arrive through the policy subscription. */
  public get value(): BuildStateValue {
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
   * only. The state instance outlives a single mount, and the shell restores a
   * previous screen exclusively through a validated snapshot, so carrying a
   * category selection, quantity draft, or display error across mounts would
   * bypass that path.
   */
  public resetTransientState(): void {
    this.#set({
      selectedCategory: null,
      quantityDrafts: emptyQuantityDrafts,
      displayError: null,
      fieldErrors: emptyFieldErrors,
    });
  }

  /**
   * Applies a previously validated feature-local snapshot without persistence.
   * Assumes the snapshot's project, if any, is already the one currently
   * loaded — the mount orchestration selects it before validating so
   * `hasCandidateReference` checks the right project's eligible candidates.
   */
  public applySnapshot(snapshot: {
    readonly selectedCategory: PartCategory | null;
    readonly quantityDrafts: Readonly<Record<string, string>>;
  }): void {
    this.#set({
      selectedCategory: snapshot.selectedCategory,
      candidates: this.#filterCandidates(
        this.#value.selectedProjectId,
        snapshot.selectedCategory,
      ),
      quantityDrafts: snapshot.quantityDrafts,
    });
  }

  /** Keeps persistent data untouched when a shell-provided snapshot is rejected. */
  public rejectSnapshotRestore(): void {
    this.#set({ displayError: { code: "snapshot-restore-failed" } });
  }

  /**
   * Re-reads the current build for the authoritative project. With a context
   * attached this issues no write and never selects a project on its own —
   * it is also the post-repair re-query path.
   */
  public async load(): Promise<void> {
    const context = this.#context;
    if (context !== null) {
      await this.#applyAvailability(context.getCurrent());
      return;
    }
    this.#set({
      isLoading: true,
      displayError: null,
      fieldErrors: emptyFieldErrors,
    });
    const projects = await this.dependencies.candidates.listProjects();
    if (!projects.ok) {
      this.#readFailure(managementErrorToBuildError(projects.error));
      return;
    }

    const selectedProjectId =
      this.#value.selectedProjectId !== null &&
      projects.value.some(
        (project) => project.id === this.#value.selectedProjectId,
      )
        ? this.#value.selectedProjectId
        : (projects.value[0]?.id ?? null);

    this.#set({ projects: projects.value });

    if (selectedProjectId === null) {
      this.#readBlocked = false;
      this.#allCandidates = [];
      this.#set({
        selectedProjectId: null,
        candidates: [],
        currentBuild: null,
        quantityDrafts: emptyQuantityDrafts,
        isLoading: false,
        mutationsDisabled: this.#mutationsDisabled(),
      });
      return;
    }

    await this.#loadForProject(selectedProjectId, null);
  }

  /**
   * Legacy screen-driven switch, kept only for the mount path that predates the
   * shared context. Once a context is attached the shared project is the sole
   * authority and this is a no-op.
   */
  public async selectProject(projectId: ProjectId): Promise<void> {
    if (this.#readBlocked || this.#context !== null) return;
    await this.#loadForProject(projectId, null);
  }

  /** Client-side filter over already-loaded candidates; issues no query. */
  public selectCategory(category: PartCategory | null): void {
    if (this.#value.selectedProjectId === null || this.#readBlocked) return;
    this.#set({
      selectedCategory: category,
      candidates: this.#filterCandidates(
        this.#value.selectedProjectId,
        category,
      ),
    });
  }

  public setQuantityDraft(
    candidatePartId: CandidatePartId,
    value: string,
  ): void {
    if (this.#readBlocked) return;
    this.#set({
      quantityDrafts: {
        ...this.#value.quantityDrafts,
        [candidatePartId]: value,
      },
    });
  }

  /** Applies a selection, quantity change, or removal; suppresses duplicate submission. */
  public async execute(command: BuildCommand): Promise<void> {
    if (this.#value.isSaving || this.#mutationsDisabled()) return;
    this.#set({
      isSaving: true,
      savingCommand: command,
      displayError: null,
      fieldErrors: emptyFieldErrors,
    });
    const createRequestId =
      this.dependencies.createRequestId ?? createDomainRequestId;
    const result = await this.dependencies.service.execute(command, {
      requestId: createRequestId(),
      expectedRevision: this.#revision,
    });
    if (!result.ok) {
      this.#readBlocked = this.#readBlocked || isTerminalError(result.error);
      this.#set({
        isSaving: false,
        savingCommand: null,
        displayError: displayError(result.error),
        fieldErrors: fieldErrorsOf(result.error),
        mutationsDisabled: this.#mutationsDisabled(),
      });
      return;
    }
    this.#revision = result.value.revision;
    const quantityDrafts =
      command.type === "set-quantity" || command.type === "remove"
        ? withoutKey(this.#value.quantityDrafts, command.candidatePartId)
        : this.#value.quantityDrafts;
    this.#set({
      currentBuild: result.value.currentBuild,
      quantityDrafts,
      isSaving: false,
      savingCommand: null,
      displayError: null,
      fieldErrors: emptyFieldErrors,
    });
  }

  /**
   * Checks against all eligible candidates for the given project, not the
   * category-filtered `value.candidates`, so a snapshot referencing a
   * candidate outside the currently selected category still validates.
   */
  public hasCandidateReference(
    candidatePartId: CandidatePartId,
    projectId: ProjectId,
  ): boolean {
    return this.#allCandidates.some(
      (candidate) =>
        candidate.id === candidatePartId && candidate.projectId === projectId,
    );
  }

  async #loadForProject(
    projectId: ProjectId,
    generation: number | null,
  ): Promise<void> {
    const token = ++this.#loadSerial;
    this.#set({
      isLoading: true,
      displayError: null,
      fieldErrors: emptyFieldErrors,
    });
    const [eligible, snapshot] = await Promise.all([
      this.dependencies.candidates.listBuildEligible(projectId),
      this.dependencies.query.getByProject(projectId),
    ]);
    // 遅れて完了した旧 project・旧 generation の結果は表示 state へ適用しない。
    if (this.#isStaleLoad(token, generation)) return;
    if (!eligible.ok) {
      this.#readFailure(managementErrorToBuildError(eligible.error));
      return;
    }
    if (!snapshot.ok) {
      this.#readFailure(snapshot.error);
      return;
    }
    this.#allCandidates = eligible.value;
    this.#revision = snapshot.value.revision;
    this.#readBlocked = false;
    this.#set({
      selectedProjectId: projectId,
      candidates: this.#filterCandidates(
        projectId,
        this.#value.selectedCategory,
      ),
      currentBuild: snapshot.value.currentBuild,
      quantityDrafts: emptyQuantityDrafts,
      isLoading: false,
      displayError: null,
      fieldErrors: emptyFieldErrors,
      mutationsDisabled: this.#mutationsDisabled(),
    });
  }

  #isStaleLoad(token: number, generation: number | null): boolean {
    return (
      token !== this.#loadSerial ||
      (generation !== null && generation !== this.#contextGeneration)
    );
  }

  #filterCandidates(
    projectId: ProjectId | null,
    category: PartCategory | null,
  ): readonly CandidatePart[] {
    if (projectId === null) return [];
    return this.#allCandidates.filter(
      (candidate) =>
        candidate.projectId === projectId &&
        (category === null || candidate.category === category),
    );
  }

  #readFailure(error: BuildError): void {
    this.#readBlocked = isTerminalError(error);
    this.#set({
      isLoading: false,
      displayError: displayError(error),
      fieldErrors: fieldErrorsOf(error),
      mutationsDisabled: this.#mutationsDisabled(),
    });
  }

  #set(update: Partial<BuildStateValue>): void {
    this.#value = { ...this.#value, ...update };
    for (const listener of this.#listeners) listener();
  }
}

export const createBuildState = (
  dependencies: BuildStateDependencies,
): BuildState => new BuildState(dependencies);
