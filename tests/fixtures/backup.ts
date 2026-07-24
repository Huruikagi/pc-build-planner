import type {
  CandidatePartId,
  CurrentBuildId,
  PositiveInteger,
  ProjectId,
  UtcTimestamp,
  Uuid,
} from "../../src/domain/public.js";
import type {
  BackupCandidatePart,
  BackupCurrentBuild,
  BackupProject,
  CurrentBackupEnvelope,
} from "../../src/features/backup-restore/contracts.js";

const PROJECT_ID = "40000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const PART_ID =
  "40000000-0000-4000-8000-000000000002" as Uuid as CandidatePartId;
const BUILD_ID =
  "40000000-0000-4000-8000-000000000003" as Uuid as CurrentBuildId;
const CREATED_AT = "2026-07-19T00:00:00.000Z" as UtcTimestamp;

const project: BackupProject = {
  id: PROJECT_ID,
  name: "架空バックアップ検証プロジェクト",
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
};

const part: BackupCandidatePart = {
  id: PART_ID,
  projectId: PROJECT_ID,
  category: "cpu",
  product: {
    name: { original: "架空CPU 原表記", confirmed: "架空CPU 確認値" },
  },
  normalizedAttributes: { category: "cpu" },
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
};

const build: BackupCurrentBuild = {
  id: BUILD_ID,
  projectId: PROJECT_ID,
  items: [{ candidatePartId: PART_ID, quantity: 1 as PositiveInteger }],
  updatedAt: CREATED_AT,
};

/** 全カテゴリの一部・非空データを持つ架空の現行形式Envelope。 */
export const buildCurrentBackupEnvelope = (): CurrentBackupEnvelope => ({
  product: "pc-build-planner",
  formatVersion: 1,
  createdAt: CREATED_AT,
  data: {
    projects: [project],
    parts: [part],
    currentBuilds: [build],
  },
});

/** 空データでも復元可能な現行形式Envelope。 */
export const buildEmptyBackupEnvelope = (): CurrentBackupEnvelope => ({
  product: "pc-build-planner",
  formatVersion: 1,
  createdAt: CREATED_AT,
  data: {
    projects: [],
    parts: [],
    currentBuilds: [],
  },
});

/**
 * 未対応の将来交換形式版。移行・検証ロジック（task 2.2）へ渡す前提のunknown fixture。
 * 現行形式版は1が初出のため、対応対象の旧版fixtureは将来の形式版追加時に用意する。
 */
export const buildFutureVersionEnvelope = (): unknown => ({
  product: "pc-build-planner",
  formatVersion: 2,
  createdAt: CREATED_AT,
  data: {
    projects: [],
    parts: [],
    currentBuilds: [],
  },
});
