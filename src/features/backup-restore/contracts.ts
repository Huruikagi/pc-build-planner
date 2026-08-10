import type {
  CandidatePartId,
  CandidateProductValues,
  CandidateSource,
  CandidateSourceId,
  CurrentBuildId,
  FoundationError,
  NormalizedAttributes,
  PartCategory,
  PositiveInteger,
  ProjectId,
  SourceSnapshot,
  UtcTimestamp,
} from "../../domain/public.js";
import type {
  BackupRestoreAssessmentTicket,
  BackupRestoreCommitMode,
  BackupRestoreFinalizationTicket,
  FoundationScopedDataPort,
} from "../../persistence/public.js";

/**
 * export参照とfinalize後の件数再構築だけに使う読取専用view。
 * compositionがFoundationのscoped portから`query`だけを狭めて供給し、
 * 通常mutation、raw root、Storage、lock、authority factoryは渡らない。
 */
export type BackupSnapshotReadPort = Pick<FoundationScopedDataPort, "query">;

export const BACKUP_PRODUCT_ID = "pc-build-planner";
export const CURRENT_BACKUP_FORMAT_VERSION = 1;

/** 保存上限10MBを基準に、ファイル読取前・JSON解析前の両方でこの定数を用いて拒否する。 */
export const MAX_RESTORE_INPUT_BYTES = 16 * 1024 * 1024;

/** 保存schemaVersionとは独立した交換形式の版。永続モデルの変更から公開契約を分離する。 */
export interface CurrentBackupEnvelope {
  readonly product: typeof BACKUP_PRODUCT_ID;
  readonly formatVersion: typeof CURRENT_BACKUP_FORMAT_VERSION;
  readonly createdAt: UtcTimestamp;
  readonly data: BackupDataV1;
}

export interface BackupDataV1 {
  readonly projects: readonly BackupProject[];
  readonly parts: readonly BackupCandidatePart[];
  readonly currentBuilds: readonly BackupCurrentBuild[];
}

export interface BackupProject {
  readonly id: ProjectId;
  readonly name: string;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
}

export interface BackupCandidatePart {
  readonly id: CandidatePartId;
  readonly projectId: ProjectId;
  readonly category: PartCategory;
  readonly product: CandidateProductValues;
  readonly sources: readonly CandidateSource[];
  readonly primarySourceId?: CandidateSourceId;
  readonly sourceSnapshot?: SourceSnapshot;
  readonly normalizedAttributes: NormalizedAttributes;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
}

export interface BackupBuildItem {
  readonly candidatePartId: CandidatePartId;
  readonly quantity: PositiveInteger;
}

export interface BackupCurrentBuild {
  readonly id: CurrentBuildId;
  readonly projectId: ProjectId;
  readonly items: readonly BackupBuildItem[];
  readonly updatedAt: UtcTimestamp;
}

/** 復元検証結果のうち、利用者へ確認可能にする件数と版だけを公開する。 */
export interface RestorePreview {
  readonly createdAt: UtcTimestamp;
  readonly formatVersion: number;
  readonly projectCount: number;
  readonly partCount: number;
  readonly currentBuildCount: number;
  readonly estimatedBytes: number;
}

export interface RestoreInput {
  readonly text: string;
  readonly byteLength: number;
}

/** preflight成功時だけ生成され、UI state外へ永続化しない非永続ticket。 */
export interface RestoreTicket {
  readonly candidate: unknown;
  readonly preview: RestorePreview;
  /** 旧state fixtureとの互換性のため任意。実サービスのpreflightは必ず両方を設定する。 */
  readonly mode?: BackupRestoreCommitMode;
  readonly assessment?: BackupRestoreAssessmentTicket;
  readonly currentAnomaly?:
    | { readonly code: "corrupt-data" }
    | { readonly code: "unsupported-version" };
}

export interface BackupArtifact {
  readonly filename: string;
  readonly mimeType: "application/json";
  readonly json: string;
  readonly byteLength: number;
}

/** commit成功時だけ返す復元後件数。ticketのpreview件数と同じ対象を確定値として示す。 */
export interface RestoreSummary {
  readonly projectCount: number;
  readonly partCount: number;
  readonly currentBuildCount: number;
}

/** root write後は通常errorへ戻さず、cleanup専用ticketを保持する。 */
export type RestoreCommitOutcome =
  | { readonly kind: "committed"; readonly summary: RestoreSummary }
  | {
      readonly kind: "committed-finalization-required";
      readonly summary: RestoreSummary;
      readonly finalization: BackupRestoreFinalizationTicket;
    };

/** 置換guardとcontext refreshの失敗。project-contextの内部値を含めずcodeだけを公開する。 */
export type RestoreContextErrorCode =
  | "guard-failed"
  | "confirmation-stale"
  | "permit-stale"
  | "context-unavailable"
  | "refresh-failed";

export interface RestoreContextError {
  readonly code: RestoreContextErrorCode;
}

/** 復元後のcontext再検証結果。project ID・catalog内容は公開しない。 */
export type RestoreContextStatus = "ready" | "empty" | "unavailable";

/** root write後の終端結果。復元成功を取り消す遷移を持たない。 */
export type RestoreCompletion =
  | {
      readonly kind: "restored";
      readonly summary: RestoreSummary;
      readonly context: "ready" | "empty";
    }
  | {
      readonly kind: "restored-finalization-required";
      readonly summary: RestoreSummary;
      readonly finalization: BackupRestoreFinalizationTicket;
    }
  | {
      readonly kind: "restored-context-unavailable";
      readonly summary: RestoreSummary;
    };

/** JSON解析、必須構造、非対応版以外の値検証失敗。問題値を含めずcodeとpathだけを公開する。 */
export type ExchangeStructureErrorCode =
  | "not-json"
  | "invalid-structure"
  | "invalid-reference";

export interface ExchangeValidationError {
  readonly code: ExchangeStructureErrorCode;
  readonly path: string;
}

export interface ExchangeVersionError {
  readonly code: "unsupported-version";
  readonly path: string;
}

export interface ExchangeMappingError {
  readonly code: "invalid-structure";
  readonly path: string;
}

export type FileErrorCode =
  | "no-file-selected"
  | "multiple-files-selected"
  | "unreadable"
  | "size-exceeded";

export interface FileError {
  readonly code: FileErrorCode;
}

export type BackupErrorCode =
  | "corrupt-current-data"
  | "unsupported-current-data"
  | "storage"
  | "serialization"
  | "backup-capacity-invariant";

export interface BackupError {
  readonly code: BackupErrorCode;
}

export type RestoreErrorCode =
  | ExchangeStructureErrorCode
  | ExchangeVersionError["code"]
  | FileErrorCode
  | "quota-exceeded"
  | "storage-unavailable"
  | "corrupt-current-data"
  | "stale-ticket"
  | "stale-assessment"
  | "precommit-cleanup-pending"
  | "maintenance-active";

/** ファイル、形式、参照、非対応版、容量、保存、stale確認の失敗を値を含まずcodeとpathで区別する。 */
export interface RestoreError {
  readonly code: RestoreErrorCode;
  readonly path?: string;
}

/** commit前失敗の再試行方針。stateとViewはこの単一policyだけを参照し個別判定を持たない。 */
export type RetryPolicy =
  | {
      readonly kind: "retryable";
      readonly action: "retry-export" | "retry-restore" | "reassess-restore";
    }
  | {
      readonly kind: "action-required";
      readonly action: "select-another-file" | "resolve-draft";
    }
  | { readonly kind: "unsupported" };

const SELECT_ANOTHER_FILE: RetryPolicy = {
  kind: "action-required",
  action: "select-another-file",
};
const UNSUPPORTED: RetryPolicy = { kind: "unsupported" };

/** export失敗の再試行方針。読取・保存の一時失敗だけを同一操作の再試行として扱う。 */
export const backupRetryPolicy = (error: BackupError): RetryPolicy => {
  switch (error.code) {
    case "storage":
      return { kind: "retryable", action: "retry-export" };
    case "corrupt-current-data":
    case "unsupported-current-data":
    case "serialization":
    case "backup-capacity-invariant":
      return UNSUPPORTED;
  }
};

/**
 * commit前の復元失敗の再試行方針。
 * ticketを保持していない失敗は同一入力を再送できないため別file選択へ倒す。
 */
export const restoreRetryPolicy = (
  error: RestoreError | FileError,
  options: { readonly hasTicket: boolean },
): RetryPolicy => {
  const withTicket = (
    action: "retry-restore" | "reassess-restore",
  ): RetryPolicy =>
    options.hasTicket ? { kind: "retryable", action } : SELECT_ANOTHER_FILE;

  switch (error.code) {
    case "no-file-selected":
    case "multiple-files-selected":
    case "unreadable":
    case "size-exceeded":
    case "not-json":
    case "invalid-structure":
    case "invalid-reference":
      return SELECT_ANOTHER_FILE;
    /** 変換後rootの容量超過は空き容量確保で解消しないため同一入力の再実行を禁止する。 */
    case "quota-exceeded":
    case "unsupported-version":
      return UNSUPPORTED;
    case "stale-assessment":
    case "stale-ticket":
    case "corrupt-current-data":
      return withTicket("reassess-restore");
    case "precommit-cleanup-pending":
    case "maintenance-active":
    case "storage-unavailable":
      return withTicket("retry-restore");
  }
};

/** guard lifecycleの失敗方針。未保存draftだけを利用者操作要求とし、staleは再試行とする。 */
export const restoreContextRetryPolicy = (
  error: RestoreContextError,
  options: { readonly hasTicket: boolean },
): RetryPolicy => {
  switch (error.code) {
    case "guard-failed":
      return { kind: "action-required", action: "resolve-draft" };
    case "confirmation-stale":
    case "permit-stale":
      return options.hasTicket
        ? { kind: "retryable", action: "retry-restore" }
        : SELECT_ANOTHER_FILE;
    case "context-unavailable":
    case "refresh-failed":
      return UNSUPPORTED;
  }
};

/** Foundationの結果を、値を含まないfeature codeへ写像する。将来のcode追加はここでの網羅性検査で検出する。 */
export const mapFoundationError = (error: FoundationError): RestoreError => {
  switch (error.code) {
    case "validation":
      return { code: "invalid-structure" };
    case "corrupt-data":
      return { code: "corrupt-current-data" };
    case "unsupported-version":
      return { code: "unsupported-version" };
    case "migration-failed":
      return { code: "invalid-structure" };
    case "repair-failed":
      return { code: "invalid-reference" };
    case "revision-conflict":
      return { code: "stale-ticket" };
    case "request-conflict":
      return { code: "stale-ticket" };
    case "maintenance-active":
    case "recovery-active":
      return { code: "maintenance-active" };
    case "stale-fence":
      return { code: "stale-ticket" };
    case "stale-assessment":
    case "stale-recovery-state":
      return { code: "stale-assessment" };
    case "precommit-cleanup-pending":
      return { code: "precommit-cleanup-pending" };
    case "quota-exceeded":
      return { code: "quota-exceeded" };
    case "access-denied":
      return { code: "storage-unavailable" };
    case "lock-unavailable":
      return { code: "storage-unavailable" };
    case "storage-unavailable":
      return { code: "storage-unavailable" };
    default: {
      const exhaustive: never = error;
      throw new Error(
        `Unmapped Foundation error code: ${JSON.stringify(exhaustive)}`,
      );
    }
  }
};
