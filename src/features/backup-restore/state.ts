import type { BackupRestoreFinalizationTicket } from "../../persistence/public.js";
import type {
  RestoreContextLifecycle,
  RestorePostCommitCoordinator,
} from "./context-lifecycle.js";
import type {
  BackupError,
  FileError,
  RestoreCommitOutcome,
  RestoreContextError,
  RestoreError,
  RestoreSummary,
  RestoreTicket,
  RetryPolicy,
} from "./contracts.js";
import {
  backupRetryPolicy,
  restoreContextRetryPolicy,
  restoreRetryPolicy,
} from "./contracts.js";
import type { FileGateway } from "./file-gateway.js";
import type { BackupService, RestoreService } from "./service.js";

export type BackupRestoreOperation = "backup" | "restore";

export type BackupRestoreFailure =
  | BackupError
  | FileError
  | RestoreError
  | RestoreContextError;

/** 処理状態、ticket、結果を判別共用体で管理する。framework非依存。 */
export type BackupRestoreStateValue =
  | { readonly phase: "idle" }
  | { readonly phase: "exporting" }
  | { readonly phase: "validating" }
  | {
      readonly phase: "awaiting-replacement-confirmation";
      readonly ticket: RestoreTicket;
    }
  | {
      readonly phase: "awaiting-draft-confirmation";
      readonly ticket: RestoreTicket;
      readonly confirmationId: string;
    }
  | { readonly phase: "restoring"; readonly ticket: RestoreTicket }
  /** 再mount由来のfinalize-onlyではsummaryを未取得のまま処理状態を表示する。 */
  | { readonly phase: "refreshing-context"; readonly summary?: RestoreSummary }
  | {
      readonly phase: "succeeded";
      readonly operation: "backup";
      readonly filename: string;
    }
  | {
      readonly phase: "succeeded";
      readonly operation: "restore";
      readonly summary: RestoreSummary;
      readonly context: "ready" | "empty";
    }
  | {
      readonly phase: "restored-finalization-required";
      /** section再mountで再発見したticketにはsummaryが伴わない。 */
      readonly summary?: RestoreSummary;
      readonly finalization: BackupRestoreFinalizationTicket;
    }
  | {
      readonly phase: "restored-context-unavailable";
      readonly summary: RestoreSummary;
    }
  | {
      readonly phase: "failed";
      readonly operation: BackupRestoreOperation;
      readonly error: BackupRestoreFailure;
      readonly retry: RetryPolicy;
      /** commit前失敗でだけ保持する検証済みticket。表示と許可actionの判定に使う。 */
      readonly ticket?: RestoreTicket;
    };

export interface BackupRestoreStateDependencies {
  readonly backupService: BackupService;
  readonly restoreService: RestoreService;
  readonly fileGateway: FileGateway;
  readonly contextLifecycle: RestoreContextLifecycle;
  readonly postCommit: RestorePostCommitCoordinator;
}

const BUSY_PHASES = new Set([
  "exporting",
  "validating",
  "restoring",
  "refreshing-context",
]);

/** root write済みの状態。復元の再実行操作を公開せず、専用retryだけを許可する。 */
const POST_COMMIT_PHASES = new Set([
  "restored-finalization-required",
  "restored-context-unavailable",
]);

const isContextError = (
  error: BackupRestoreFailure,
): error is RestoreContextError =>
  error.code === "guard-failed" ||
  error.code === "confirmation-stale" ||
  error.code === "permit-stale" ||
  error.code === "context-unavailable" ||
  error.code === "refresh-failed";

/** Framework非依存のUI state。永続化とDOM I/Oは注入されたportだけを介す。 */
export class BackupRestoreState {
  #value: BackupRestoreStateValue = { phase: "idle" };
  #listeners = new Set<() => void>();
  #lifecycleEpoch = 0;

  public constructor(
    private readonly dependencies: BackupRestoreStateDependencies,
  ) {}

  public get value(): BackupRestoreStateValue {
    return this.#value;
  }

  public subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      this.#listeners.delete(listener);
    };
  }

  #isBusy(): boolean {
    return BUSY_PHASES.has(this.#value.phase);
  }

  #isPostCommit(): boolean {
    return POST_COMMIT_PHASES.has(this.#value.phase);
  }

  /** バックアップ生成からダウンロードまで一括実行する。処理中の重複要求は抑止する。 */
  public async exportBackup(): Promise<void> {
    if (this.#isBusy()) return;
    const epoch = this.#lifecycleEpoch;
    this.#set({ phase: "exporting" });

    const artifact = await this.dependencies.backupService.create();
    if (epoch !== this.#lifecycleEpoch) return;
    if (!artifact.ok) {
      this.#failBackup(artifact.error);
      return;
    }

    const downloaded = this.dependencies.fileGateway.download(artifact.value);
    if (!downloaded.ok) {
      /** download失敗はartifactを作り直せるため、別file選択ではなく再export扱いにする。 */
      this.#set({
        phase: "failed",
        operation: "backup",
        error: downloaded.error,
        retry: { kind: "retryable", action: "retry-export" },
      });
      return;
    }

    this.#set({
      phase: "succeeded",
      operation: "backup",
      filename: artifact.value.filename,
    });
  }

  /**
   * 選択ファイルを読取・preflightする。処理中とcommit後は受け付けず、
   * それ以外の再選択は未commit ticketを破棄して新しい検証結果へ差し替える。
   */
  public async validateFile(file: File): Promise<void> {
    if (this.#isBusy() || this.#isPostCommit()) return;
    const epoch = this.#lifecycleEpoch;
    this.#set({ phase: "validating" });

    const read = await this.dependencies.fileGateway.read(file);
    if (epoch !== this.#lifecycleEpoch) return;
    if (!read.ok) {
      this.#failRestore(read.error, undefined);
      return;
    }

    const preflight = await this.dependencies.restoreService.preflight(
      read.value,
    );
    if (epoch !== this.#lifecycleEpoch) return;
    if (!preflight.ok) {
      this.#failRestore(preflight.error, undefined);
      return;
    }

    this.#set({
      phase: "awaiting-replacement-confirmation",
      ticket: preflight.value,
    });
  }

  /** 置換確認済みticketのguard lifecycleを開始する。他phaseからの呼び出しは無視する。 */
  public async confirmRestore(): Promise<void> {
    if (this.#value.phase !== "awaiting-replacement-confirmation") return;
    await this.#startGuardedRestore(this.#value.ticket);
  }

  /** 未保存draftの影響を承諾した後だけpermitを取得してcommitへ進む。 */
  public async approveDraft(): Promise<void> {
    if (this.#value.phase !== "awaiting-draft-confirmation") return;
    const { ticket, confirmationId } = this.#value;
    const epoch = this.#lifecycleEpoch;
    this.#set({ phase: "restoring", ticket });

    const confirmed =
      await this.dependencies.contextLifecycle.confirm(confirmationId);
    if (epoch !== this.#lifecycleEpoch) return;
    if (!confirmed.ok) {
      this.#failRestore(confirmed.error, ticket);
      return;
    }
    await this.#beginAndCommit(confirmed.value.id, ticket, epoch);
  }

  /** draft確認の取消。guard確認だけを閉じ、ticketと置換確認状態は保持する。 */
  public cancelDraft(): void {
    if (this.#value.phase !== "awaiting-draft-confirmation") return;
    const { ticket, confirmationId } = this.#value;
    this.dependencies.contextLifecycle.cancel(confirmationId);
    this.#set({ phase: "awaiting-replacement-confirmation", ticket });
  }

  /** 同じticketと新しいguard permitでcommitだけを再試行する。 */
  public async retryRestore(): Promise<void> {
    const failure = this.#retryableFailure("retry-restore");
    if (failure === undefined) return;
    await this.#startGuardedRestore(failure);
  }

  /** 保持中candidateを再assessmentし、新しいpreviewから置換確認をやり直す。 */
  public async reassessRestore(): Promise<void> {
    const failure = this.#retryableFailure("reassess-restore");
    if (failure === undefined) return;
    const reassess = this.dependencies.restoreService.reassess;
    if (reassess === undefined) return;

    const epoch = this.#lifecycleEpoch;
    this.#set({ phase: "validating" });
    const reassessed = await reassess(failure);
    if (epoch !== this.#lifecycleEpoch) return;
    if (!reassessed.ok) {
      this.#failRestore(reassessed.error, failure);
      return;
    }
    this.#set({
      phase: "awaiting-replacement-confirmation",
      ticket: reassessed.value,
    });
  }

  /** root write後のcleanupだけを再試行する。Foundation commitとguardは再実行しない。 */
  public async finalizeRestore(): Promise<void> {
    if (this.#value.phase !== "restored-finalization-required") return;
    const { summary, finalization } = this.#value;
    const epoch = this.#lifecycleEpoch;
    const withSummary = summary === undefined ? {} : { summary };
    this.#set({ phase: "refreshing-context", ...withSummary });

    const finalized = await this.dependencies.postCommit.finalizeOnly(
      finalization,
      summary,
    );
    if (epoch !== this.#lifecycleEpoch) return;
    if (!finalized.ok) {
      this.#set({
        phase: "restored-finalization-required",
        ...withSummary,
        finalization,
      });
      return;
    }
    this.#applyCompletion(finalized.value);
  }

  /** context再検証だけを再試行する。復元済みrootを再置換しない。 */
  public async refreshContext(): Promise<void> {
    if (this.#value.phase !== "restored-context-unavailable") return;
    const { summary } = this.#value;
    const epoch = this.#lifecycleEpoch;
    this.#set({ phase: "refreshing-context", summary });

    const completion = await this.dependencies.postCommit.refreshOnly(summary);
    if (epoch !== this.#lifecycleEpoch) return;
    this.#applyCompletion(completion);
  }

  /** 確認取消、または失敗・成功後の再試行準備としてidleへ戻す。処理中は無視する。 */
  public cancel(): void {
    if (this.#isBusy() || this.#isPostCommit()) return;
    if (this.#value.phase === "awaiting-draft-confirmation")
      this.dependencies.contextLifecycle.cancel(this.#value.confirmationId);
    this.#set({ phase: "idle" });
  }

  /** mount lifecycleを切り替え、旧mountの非同期結果と未commit ticketを失効させる。 */
  public resetForMount(): void {
    this.#lifecycleEpoch += 1;
    this.#set({ phase: "idle" });
  }

  /**
   * 通常idle表示を確定させる前にFoundation所有のpending finalizationを照会する。
   * 存在すればsummary無しのfinalize-only状態を再水和し、無い・照会失敗ではidleを保つ。
   */
  public async rehydratePendingFinalization(): Promise<void> {
    const find = this.dependencies.restoreService.findPendingFinalization;
    if (find === undefined) return;
    const epoch = this.#lifecycleEpoch;

    const pending = await find();
    if (epoch !== this.#lifecycleEpoch) return;
    /** 照会中に利用者操作が始まっていた場合はその状態を上書きしない。 */
    if (this.#value.phase !== "idle") return;
    if (!pending.ok || pending.value === null) return;

    this.#set({
      phase: "restored-finalization-required",
      finalization: pending.value,
    });
  }

  async #startGuardedRestore(ticket: RestoreTicket): Promise<void> {
    const epoch = this.#lifecycleEpoch;
    this.#set({ phase: "restoring", ticket });

    const prepared = await this.dependencies.contextLifecycle.prepare();
    if (epoch !== this.#lifecycleEpoch) return;
    if (!prepared.ok) {
      this.#failRestore(prepared.error, ticket);
      return;
    }
    if (prepared.value.kind === "confirmation-required") {
      this.#set({
        phase: "awaiting-draft-confirmation",
        ticket,
        confirmationId: prepared.value.confirmation.id,
      });
      return;
    }
    await this.#beginAndCommit(prepared.value.permit.id, ticket, epoch);
  }

  async #beginAndCommit(
    permitId: string,
    ticket: RestoreTicket,
    epoch: number,
  ): Promise<void> {
    const begun = this.dependencies.contextLifecycle.begin(permitId);
    /** begin成功かつpermitが開いている場合だけFoundation commitへ進む。 */
    const allowed =
      begun.ok && this.dependencies.contextLifecycle.isCommitAllowed(permitId);
    if (!allowed) {
      if (epoch === this.#lifecycleEpoch)
        this.#failRestore(
          begun.ok ? { code: "permit-stale" } : begun.error,
          ticket,
        );
      return;
    }

    const committed = await this.dependencies.restoreService.commit(ticket);
    if (epoch !== this.#lifecycleEpoch) return;
    if (!committed.ok) {
      await this.dependencies.contextLifecycle.complete(permitId, "failed");
      if (epoch !== this.#lifecycleEpoch) return;
      this.#failRestore(committed.error, ticket);
      return;
    }

    const outcome: RestoreCommitOutcome =
      "kind" in committed.value
        ? committed.value
        : { kind: "committed", summary: committed.value };
    this.#set({ phase: "refreshing-context", summary: outcome.summary });

    const completion = await this.dependencies.postCommit.afterCommit({
      permitId,
      outcome,
    });
    if (epoch !== this.#lifecycleEpoch) return;
    this.#applyCompletion(completion);
  }

  #applyCompletion(
    completion: Awaited<
      ReturnType<RestorePostCommitCoordinator["afterCommit"]>
    >,
  ): void {
    switch (completion.kind) {
      case "restored":
        this.#set({
          phase: "succeeded",
          operation: "restore",
          summary: completion.summary,
          context: completion.context,
        });
        return;
      case "restored-finalization-required":
        this.#set({
          phase: "restored-finalization-required",
          summary: completion.summary,
          finalization: completion.finalization,
        });
        return;
      case "restored-context-unavailable":
        this.#set({
          phase: "restored-context-unavailable",
          summary: completion.summary,
        });
    }
  }

  /** 指定actionが許可されたfailedのticketだけを返す。unsupportedはここで遮断する。 */
  #retryableFailure(
    action: "retry-restore" | "reassess-restore",
  ): RestoreTicket | undefined {
    const value = this.#value;
    if (value.phase !== "failed" || value.operation !== "restore")
      return undefined;
    const retry = value.retry;
    /** 未保存draftの解消は利用者側の操作であり、その後は同じticketで再試行できる。 */
    const allowed =
      (retry.kind === "retryable" && retry.action === action) ||
      (action === "retry-restore" &&
        retry.kind === "action-required" &&
        retry.action === "resolve-draft");
    if (!allowed) return undefined;
    return value.ticket;
  }

  #failBackup(error: BackupError): void {
    this.#set({
      phase: "failed",
      operation: "backup",
      error,
      retry: backupRetryPolicy(error),
    });
  }

  #failRestore(
    error: RestoreError | FileError | RestoreContextError,
    ticket: RestoreTicket | undefined,
  ): void {
    const hasTicket = ticket !== undefined;
    const retry = isContextError(error)
      ? restoreContextRetryPolicy(error, { hasTicket })
      : restoreRetryPolicy(error, { hasTicket });
    this.#set({
      phase: "failed",
      operation: "restore",
      error,
      retry,
      ...(ticket === undefined ? {} : { ticket }),
    });
  }

  #set(value: BackupRestoreStateValue): void {
    this.#value = value;
    for (const listener of this.#listeners) listener();
  }
}

export const createBackupRestoreState = (
  dependencies: BackupRestoreStateDependencies,
): BackupRestoreState => new BackupRestoreState(dependencies);
