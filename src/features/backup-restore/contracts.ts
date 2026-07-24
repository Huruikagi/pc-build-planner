import type {
  CandidatePartId,
  CandidateProductValues,
  CurrentBuildId,
  FoundationError,
  NormalizedAttributes,
  PartCategory,
  PositiveInteger,
  ProjectId,
  SourceInfo,
  SourceSnapshot,
  UtcTimestamp,
} from "../../domain/public.js";
import type { ReplacementAssessment } from "../../persistence/public.js";

export const BACKUP_PRODUCT_ID = "pc-build-planner";
export const CURRENT_BACKUP_FORMAT_VERSION = 1;

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
  readonly sourceInfo?: SourceInfo;
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
  readonly assessment: ReplacementAssessment;
  readonly preview: RestorePreview;
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
  | "serialization";

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
  | "maintenance-active";

/** ファイル、形式、参照、非対応版、容量、保存、stale確認の失敗を値を含まずcodeとpathで区別する。 */
export interface RestoreError {
  readonly code: RestoreErrorCode;
  readonly path?: string;
}

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
      return { code: "maintenance-active" };
    case "stale-fence":
      return { code: "stale-ticket" };
    case "stale-assessment":
      return { code: "stale-ticket" };
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
