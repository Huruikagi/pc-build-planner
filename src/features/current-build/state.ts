import type { OperationPolicy } from "../../application-shell/public.js";
import {
  type CandidatePart,
  type CandidatePartId,
  type CurrentBuild,
  createRequestId as createDomainRequestId,
  type PartCategory,
  type ProjectId,
  type RequestId,
  type Result,
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
  BuildContextAdapterError,
  BuildDraftGuardOwner,
  BuildProjectAvailability,
  BuildProjectSwitch,
  CurrentBuildProjectContextAdapter,
} from "./project-context-adapter.js";
import { managementErrorToBuildError } from "./service.js";

/** 切替確認中に保持する、確認一件分のowner-localな文脈（要件 7.2、7.8）。 */
export interface BuildSwitchConfirmation {
  readonly token: string;
  readonly fromProjectId: ProjectId | null;
  readonly toProjectId: ProjectId | null;
  readonly baseGeneration: number;
  readonly drafts: Readonly<Record<string, string>>;
}

/** 強制変更で隔離したdraft。利用者が明示的に破棄するまで保持する（要件 7.7）。 */
export interface BuildOrphanedDraft {
  readonly projectId: ProjectId | null;
  readonly drafts: Readonly<Record<string, string>>;
}

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
  /** All eligible candidates for category summary projection, independent of the active filter. */
  readonly summaryCandidates: readonly CandidatePart[];
  readonly candidates: readonly CandidatePart[];
  readonly currentBuild: Readonly<CurrentBuild> | null;
  readonly quantityDrafts: Readonly<Record<string, string>>;
  readonly switchConfirmation: BuildSwitchConfirmation | null;
  readonly orphanedDraft: BuildOrphanedDraft | null;
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

const withoutKeys = (
  record: Readonly<Record<string, string>>,
  keys: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string>> => {
  const next = { ...record };
  for (const key of Object.keys(keys)) delete next[key];
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
  #guardOwner: BuildDraftGuardOwner | null = null;
  #pendingSwitch: {
    readonly confirmation: BuildSwitchConfirmation;
    readonly settle: (
      result: Result<"allow", BuildContextAdapterError>,
    ) => void;
    settled: boolean;
    saving: boolean;
  } | null = null;
  #value: BuildStateValue = {
    projects: [],
    projectAvailability: null,
    selectedProjectId: null,
    selectedCategory: null,
    summaryCandidates: [],
    candidates: [],
    currentBuild: null,
    quantityDrafts: emptyQuantityDrafts,
    switchConfirmation: null,
    orphanedDraft: null,
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
    // 確定済みcontextが動いた時点で、進行中の確認結果は適用できない。
    this.#settleSwitch({ ok: false, error: { kind: "stale-request" } });
    if (availability.status !== "ready") {
      // project 固有の状態を解放し、変更操作を止めた理由を表示できる状態にする。
      this.#allCandidates = [];
      this.#revision = 0 as Revision;
      this.#loadSerial += 1;
      // 先に availability を確定させてから変更可否を評価する。
      this.#set({ projectAvailability: availability.status });
      this.#set({
        selectedProjectId: null,
        summaryCandidates: [],
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

  /**
   * The feature owns save/discard/cancel; the adapter only learns whether the
   * switch may proceed. Draft content never crosses the context boundary.
   */
  public draftGuardOwner(): BuildDraftGuardOwner {
    this.#guardOwner ??= {
      evaluate: (change) => this.#evaluateSwitch(change),
      notifyForced: (change) => this.#handleForcedSwitch(change),
    };
    return this.#guardOwner;
  }

  /** Only quantities that differ from what is already saved count as unsaved. */
  #dirtyDrafts(): Readonly<Record<string, string>> {
    const drafts: Record<string, string> = {};
    for (const item of this.#value.currentBuild?.items ?? []) {
      const draft = this.#value.quantityDrafts[item.candidatePartId];
      if (draft !== undefined && draft.trim() !== String(item.quantity))
        drafts[item.candidatePartId] = draft;
    }
    return drafts;
  }

  #evaluateSwitch(
    change: BuildProjectSwitch,
  ): Promise<Result<"allow", BuildContextAdapterError>> {
    const drafts = this.#dirtyDrafts();
    // 先行する確認は新しい要求に追い越された時点で古い。
    this.#settleSwitch({ ok: false, error: { kind: "stale-request" } });
    if (Object.keys(drafts).length === 0)
      return Promise.resolve({ ok: true, value: "allow" });
    const confirmation: BuildSwitchConfirmation = {
      token: change.token,
      fromProjectId: this.#value.selectedProjectId,
      toProjectId: change.to,
      baseGeneration: change.baseGeneration,
      drafts,
    };
    return new Promise((resolve) => {
      this.#pendingSwitch = {
        confirmation,
        settle: resolve,
        settled: false,
        saving: false,
      };
      this.#set({ switchConfirmation: confirmation });
    });
  }

  #handleForcedSwitch(change: BuildProjectSwitch): void {
    this.#settleSwitch({ ok: false, error: { kind: "stale-request" } });
    // cause "user" は本featureのevaluateで保存・破棄を確定させた後の通知。
    if (change.cause === "user") return;
    const drafts = this.#dirtyDrafts();
    if (Object.keys(drafts).length === 0) return;
    // 新しいprojectへ暗黙保存せず、隔離して継続方法を案内できる状態にする。
    this.#set({
      orphanedDraft: { projectId: change.from, drafts },
      quantityDrafts: withoutKeys(this.#value.quantityDrafts, drafts),
    });
  }

  #settleSwitch(result: Result<"allow", BuildContextAdapterError>): void {
    const pending = this.#pendingSwitch;
    if (pending === null || pending.settled) return;
    pending.settled = true;
    this.#pendingSwitch = null;
    this.#set({ switchConfirmation: null });
    pending.settle(result);
  }

  /** A confirmation whose base generation has moved on must not be applied. */
  #staleConfirmation(baseGeneration: number): boolean {
    return (
      this.#contextGeneration !== null &&
      this.#contextGeneration !== baseGeneration
    );
  }

  /** Commits every unsaved quantity of the previous project as one update. */
  public async saveSwitchDrafts(): Promise<void> {
    const pending = this.#pendingSwitch;
    if (pending === null || pending.saving) return;
    if (this.#staleConfirmation(pending.confirmation.baseGeneration)) {
      this.#settleSwitch({ ok: false, error: { kind: "stale-request" } });
      return;
    }
    const fromProjectId = pending.confirmation.fromProjectId;
    if (fromProjectId === null) {
      this.#settleSwitch({ ok: false, error: { kind: "guard-declined" } });
      return;
    }
    pending.saving = true;
    const quantities: Record<string, number> = {};
    for (const [candidatePartId, draft] of Object.entries(
      pending.confirmation.drafts,
    ))
      quantities[candidatePartId] = Number(draft);
    const saved = await this.#executeCommand({
      type: "set-quantities",
      projectId: fromProjectId,
      quantities: quantities as Readonly<Record<CandidatePartId, number>>,
    });
    pending.saving = false;
    // 全件commitできた場合だけ切替を続行する。
    this.#settleSwitch(
      saved
        ? { ok: true, value: "allow" }
        : { ok: false, error: { kind: "guard-declined" } },
    );
  }

  /** Drops the confirmed drafts and lets the switch continue. */
  public discardSwitchDrafts(): void {
    const pending = this.#pendingSwitch;
    if (pending === null || pending.saving) return;
    if (this.#staleConfirmation(pending.confirmation.baseGeneration)) {
      this.#settleSwitch({ ok: false, error: { kind: "stale-request" } });
      return;
    }
    this.#set({
      quantityDrafts: withoutKeys(
        this.#value.quantityDrafts,
        pending.confirmation.drafts,
      ),
    });
    this.#settleSwitch({ ok: true, value: "allow" });
  }

  /** Keeps both the drafts and the previous project; the switch is abandoned. */
  public cancelSwitch(): void {
    const pending = this.#pendingSwitch;
    if (pending === null || pending.saving) return;
    this.#settleSwitch({ ok: false, error: { kind: "guard-declined" } });
  }

  /** Isolated drafts survive until the user explicitly drops them. */
  public dismissOrphanedDraft(): void {
    if (this.#value.orphanedDraft === null) return;
    this.#set({ orphanedDraft: null });
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
        summaryCandidates: [],
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
    await this.#executeCommand(command);
  }

  /** Returns whether the command committed, for callers that gate on the result. */
  async #executeCommand(command: BuildCommand): Promise<boolean> {
    if (this.#value.isSaving || this.#mutationsDisabled()) return false;
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
      return false;
    }
    this.#revision = result.value.revision;
    this.#set({
      currentBuild: result.value.currentBuild,
      quantityDrafts: this.#draftsAfter(command),
      isSaving: false,
      savingCommand: null,
      displayError: null,
      fieldErrors: emptyFieldErrors,
    });
    return true;
  }

  /** Committed quantities are no longer unsaved input. */
  #draftsAfter(command: BuildCommand): Readonly<Record<string, string>> {
    if (command.type === "set-quantities")
      return withoutKeys(this.#value.quantityDrafts, command.quantities);
    return command.type === "set-quantity" || command.type === "remove"
      ? withoutKey(this.#value.quantityDrafts, command.candidatePartId)
      : this.#value.quantityDrafts;
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
      summaryCandidates: eligible.value,
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
