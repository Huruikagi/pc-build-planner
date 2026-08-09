import type {
  BackupError,
  FileError,
  RestoreError,
  RestoreSummary,
  RestoreTicket,
} from "./contracts.js";
import type { FileGateway } from "./file-gateway.js";
import type { BackupService, RestoreService } from "./service.js";

export type BackupRestoreOperation = "backup" | "restore";

/** 処理状態、ticket、結果を判別共用体で管理する。framework非依存。 */
export type BackupRestoreStateValue =
  | { readonly phase: "idle" }
  | { readonly phase: "exporting" }
  | { readonly phase: "validating" }
  | { readonly phase: "awaiting-confirmation"; readonly ticket: RestoreTicket }
  | { readonly phase: "restoring"; readonly ticket: RestoreTicket }
  | {
      readonly phase: "succeeded";
      readonly operation: "backup";
      readonly filename: string;
    }
  | {
      readonly phase: "succeeded";
      readonly operation: "restore";
      readonly summary: RestoreSummary;
    }
  | {
      readonly phase: "failed";
      readonly operation: BackupRestoreOperation;
      readonly error: BackupError | RestoreError | FileError;
    };

export interface BackupRestoreStateDependencies {
  readonly backupService: BackupService;
  readonly restoreService: RestoreService;
  readonly fileGateway: FileGateway;
}

const BUSY_PHASES = new Set(["exporting", "validating", "restoring"]);

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

  /** バックアップ生成からダウンロードまで一括実行する。処理中の重複要求は抑止する。 */
  public async exportBackup(): Promise<void> {
    if (this.#isBusy()) return;
    const epoch = this.#lifecycleEpoch;
    this.#set({ phase: "exporting" });

    const artifact = await this.dependencies.backupService.create();
    if (epoch !== this.#lifecycleEpoch) return;
    if (!artifact.ok) {
      this.#set({
        phase: "failed",
        operation: "backup",
        error: artifact.error,
      });
      return;
    }

    const downloaded = this.dependencies.fileGateway.download(artifact.value);
    if (!downloaded.ok) {
      this.#set({
        phase: "failed",
        operation: "backup",
        error: downloaded.error,
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
   * 選択ファイルを読取・preflightする。処理中は重複要求を抑止し、
   * awaiting-confirmation中の再選択は既存ticketを新しい検証結果へ差し替える。
   */
  public async validateFile(file: File): Promise<void> {
    if (this.#isBusy()) return;
    const epoch = this.#lifecycleEpoch;
    this.#set({ phase: "validating" });

    const read = await this.dependencies.fileGateway.read(file);
    if (epoch !== this.#lifecycleEpoch) return;
    if (!read.ok) {
      this.#set({ phase: "failed", operation: "restore", error: read.error });
      return;
    }

    const preflight = await this.dependencies.restoreService.preflight(
      read.value,
    );
    if (epoch !== this.#lifecycleEpoch) return;
    if (!preflight.ok) {
      this.#set({
        phase: "failed",
        operation: "restore",
        error: preflight.error,
      });
      return;
    }

    this.#set({ phase: "awaiting-confirmation", ticket: preflight.value });
  }

  /** awaiting-confirmation中のticketだけを確定復元する。他phaseからの呼び出しは無視する。 */
  public async confirmRestore(): Promise<void> {
    if (this.#value.phase !== "awaiting-confirmation") return;
    const epoch = this.#lifecycleEpoch;
    const ticket = this.#value.ticket;
    this.#set({ phase: "restoring", ticket });

    const result = await this.dependencies.restoreService.commit(ticket);
    if (epoch !== this.#lifecycleEpoch) return;
    if (!result.ok) {
      this.#set({
        phase: "failed",
        operation: "restore",
        error: result.error,
      });
      return;
    }

    if ("kind" in result.value && result.value.kind !== "committed") {
      this.#set({
        phase: "failed",
        operation: "restore",
        error: { code: "maintenance-active" },
      });
      return;
    }
    this.#set({
      phase: "succeeded",
      operation: "restore",
      summary: "kind" in result.value ? result.value.summary : result.value,
    });
  }

  /** 確認取消、または失敗・成功後の再試行準備としてidleへ戻す。処理中は無視する。 */
  public cancel(): void {
    if (this.#isBusy()) return;
    this.#set({ phase: "idle" });
  }

  /** mount lifecycleを切り替え、旧mountの非同期結果を失効させる。 */
  public resetForMount(): void {
    this.#lifecycleEpoch += 1;
    this.#set({ phase: "idle" });
  }

  #set(value: BackupRestoreStateValue): void {
    this.#value = value;
    for (const listener of this.#listeners) listener();
  }
}

export const createBackupRestoreState = (
  dependencies: BackupRestoreStateDependencies,
): BackupRestoreState => new BackupRestoreState(dependencies);
