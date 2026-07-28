import type { RequestId, Revision, UtcTimestamp, Uuid } from "./identifiers.js";
import type {
  CandidateProductValues,
  MoneyValue,
  NormalizedAttributes,
  PartCategory,
  SourcedValue,
  SourceInfo,
  SourceSnapshot,
} from "./normalized-attributes.js";

declare const projectIdBrand: unique symbol;
declare const candidatePartIdBrand: unique symbol;
declare const candidateSourceIdBrand: unique symbol;
declare const currentBuildIdBrand: unique symbol;
declare const maintenanceOwnerIdBrand: unique symbol;
declare const positiveIntegerBrand: unique symbol;
declare const maintenanceGenerationBrand: unique symbol;

export type ProjectId = Uuid & { readonly [projectIdBrand]: "ProjectId" };
export type CandidatePartId = Uuid & {
  readonly [candidatePartIdBrand]: "CandidatePartId";
};
export type CandidateSourceId = Uuid & {
  readonly [candidateSourceIdBrand]: "CandidateSourceId";
};
export type CurrentBuildId = Uuid & {
  readonly [currentBuildIdBrand]: "CurrentBuildId";
};
export type MaintenanceOwnerId = Uuid & {
  readonly [maintenanceOwnerIdBrand]: "MaintenanceOwnerId";
};
export type PositiveInteger = number & {
  readonly [positiveIntegerBrand]: "PositiveInteger";
};
export type MaintenanceGeneration = number & {
  readonly [maintenanceGenerationBrand]: "MaintenanceGeneration";
};

export interface Project {
  readonly id: ProjectId;
  readonly name: string;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
}

export interface CandidatePart {
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

export type CandidateSourceKind = "retail" | "manufacturer";

export interface CandidateSource {
  readonly id: CandidateSourceId;
  readonly pageUrl?: string;
  readonly siteName?: string;
  readonly capturedAt?: UtcTimestamp;
  readonly price?: SourcedValue<MoneyValue>;
  readonly kind?: CandidateSourceKind;
}

export type CandidateProductValuesV2 = Omit<CandidateProductValues, "price">;

export type CandidateSourceState =
  | {
      readonly sources: readonly [];
      readonly primarySourceId?: never;
    }
  | {
      readonly sources: readonly [CandidateSource, ...CandidateSource[]];
      readonly primarySourceId: CandidateSourceId;
    };

/** Schema 2 candidate contract staged independently from the live schema 1 model. */
export type CandidatePartV2 = Omit<CandidatePart, "product" | "sourceInfo"> & {
  readonly product: CandidateProductValuesV2;
} & CandidateSourceState;

export interface BuildItem {
  readonly candidatePartId: CandidatePartId;
  readonly quantity: PositiveInteger;
}

export interface CurrentBuild {
  readonly id: CurrentBuildId;
  readonly projectId: ProjectId;
  readonly items: readonly BuildItem[];
  readonly updatedAt: UtcTimestamp;
}

/** 同一request IDの安全な再試行判定に必要な最小の永続記録。 */
export interface RequestDedupeRecord {
  readonly requestId: RequestId;
  readonly payloadDigest: string;
  readonly committedRevision: Revision;
}

export interface InactiveMaintenanceState {
  readonly generation: MaintenanceGeneration;
  readonly active: false;
}

export interface ActiveMaintenanceState {
  readonly generation: MaintenanceGeneration;
  readonly active: true;
  readonly ownerId: MaintenanceOwnerId;
  readonly leaseExpiresAt: UtcTimestamp;
}

export type MaintenanceState =
  | InactiveMaintenanceState
  | ActiveMaintenanceState;

/** chrome.storage.local の一つのkeyへ保存する整合性・transaction単位。 */
export interface LocalDataRoot {
  readonly schemaVersion: 1;
  readonly revision: Revision;
  readonly projects: readonly Project[];
  readonly candidateParts: readonly CandidatePart[];
  readonly currentBuilds: readonly CurrentBuild[];
  readonly requestDedupe: readonly RequestDedupeRecord[];
  readonly maintenance: MaintenanceState;
}

/** Versioned root used by schema 2 validators and adapters before production cutover. */
export type LocalDataRootV2 = Omit<
  LocalDataRoot,
  "schemaVersion" | "candidateParts"
> & {
  readonly schemaVersion: 2;
  readonly candidateParts: readonly CandidatePartV2[];
};
