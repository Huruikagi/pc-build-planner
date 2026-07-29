import type {
  CandidatePartId,
  CandidateSourceId,
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
const PRIMARY_SOURCE_ID =
  "40000000-0000-4000-8000-000000000004" as Uuid as CandidateSourceId;
const SECONDARY_SOURCE_ID =
  "40000000-0000-4000-8000-000000000005" as Uuid as CandidateSourceId;
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
  sources: [
    {
      id: PRIMARY_SOURCE_ID,
      pageUrl: "https://shop.example.invalid/fictional-cpu",
      siteName: "架空販売店",
      capturedAt: CREATED_AT,
      price: {
        original: "架空価格 12,345 SYN",
        confirmed: { amount: 12345, currency: "SYN" },
      },
      kind: "retail",
    },
    {
      id: SECONDARY_SOURCE_ID,
      pageUrl: "https://manufacturer.example.invalid/fictional-cpu",
      siteName: "架空メーカー",
      capturedAt: CREATED_AT,
      kind: "manufacturer",
    },
  ],
  primarySourceId: PRIMARY_SOURCE_ID,
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

export interface CorruptBackupEnvelope {
  readonly name: string;
  readonly envelope: unknown;
  readonly expectedCode: string;
  readonly expectedPath: string;
}

const corrupted = (change: (envelope: Record<string, unknown>) => void) => {
  const envelope = structuredClone(
    buildCurrentBackupEnvelope(),
  ) as unknown as Record<string, unknown>;
  change(envelope);
  return envelope;
};

/** ExchangeValidator境界専用。破損値も実サイトassetを一切含まない。 */
export const buildCorruptBackupEnvelopes =
  (): readonly CorruptBackupEnvelope[] => [
    {
      name: "product mismatch",
      envelope: corrupted((envelope) => {
        envelope.product = "other-product";
      }),
      expectedCode: "invalid-structure",
      expectedPath: "$.product",
    },
    {
      name: "unsupported format version",
      envelope: corrupted((envelope) => {
        envelope.formatVersion = 2;
      }),
      expectedCode: "invalid-structure",
      expectedPath: "$.formatVersion",
    },
    {
      name: "unexpected top-level field",
      envelope: corrupted((envelope) => {
        envelope.unexpected = "架空余剰値";
      }),
      expectedCode: "invalid-structure",
      expectedPath: "$.unexpected",
    },
    {
      name: "missing createdAt",
      envelope: corrupted((envelope) => {
        delete envelope.createdAt;
      }),
      expectedCode: "invalid-structure",
      expectedPath: "$.createdAt",
    },
    {
      name: "orphan candidate project reference",
      envelope: corrupted((envelope) => {
        const data = envelope.data as Record<string, unknown>;
        const parts = data.parts as Array<Record<string, unknown>>;
        if (parts[0])
          parts[0].projectId = "90000000-0000-4000-8000-000000000001";
      }),
      expectedCode: "invalid-reference",
      expectedPath: "$.data.parts[0].projectId",
    },
    {
      name: "unsafe candidate source URL",
      envelope: corrupted((envelope) => {
        const data = envelope.data as Record<string, unknown>;
        const parts = data.parts as Array<Record<string, unknown>>;
        const sources = parts[0]?.sources as
          | Array<Record<string, unknown>>
          | undefined;
        if (sources?.[0]) sources[0].pageUrl = "javascript:alert(1)";
      }),
      expectedCode: "invalid-structure",
      expectedPath: "$.data.parts[0].sources[0].pageUrl",
    },
    {
      name: "missing primary source reference",
      envelope: corrupted((envelope) => {
        const data = envelope.data as Record<string, unknown>;
        const parts = data.parts as Array<Record<string, unknown>>;
        if (parts[0])
          parts[0].primarySourceId = "90000000-0000-4000-8000-000000000001";
      }),
      expectedCode: "invalid-reference",
      expectedPath: "$.data.parts[0].primarySourceId",
    },
    {
      name: "cross-project current build reference",
      envelope: corrupted((envelope) => {
        const data = envelope.data as Record<string, unknown>;
        const otherProject = {
          id: "90000000-0000-4000-8000-000000000002",
          name: "架空別プロジェクト",
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
        };
        (data.projects as unknown[]).push(otherProject);
        const builds = data.currentBuilds as Array<Record<string, unknown>>;
        if (builds[0]) builds[0].projectId = otherProject.id;
      }),
      expectedCode: "invalid-reference",
      expectedPath: "$.data.currentBuilds[0].items[0].candidatePartId",
    },
    {
      name: "duplicate project id",
      envelope: corrupted((envelope) => {
        const data = envelope.data as Record<string, unknown>;
        const projects = data.projects as Array<Record<string, unknown>>;
        if (projects[0]) projects.push({ ...projects[0] });
      }),
      expectedCode: "invalid-reference",
      expectedPath: "$.data.projects[1].id",
    },
    {
      name: "invalid build item quantity",
      envelope: corrupted((envelope) => {
        const data = envelope.data as Record<string, unknown>;
        const builds = data.currentBuilds as Array<Record<string, unknown>>;
        const items = builds[0]?.items as
          | Array<Record<string, unknown>>
          | undefined;
        if (items?.[0]) items[0].quantity = 0;
      }),
      expectedCode: "invalid-structure",
      expectedPath: "$.data.currentBuilds[0].items[0].quantity",
    },
    {
      name: "forbidden nested key",
      envelope: corrupted((envelope) => {
        const data = envelope.data as Record<string, unknown>;
        const parts = data.parts as Array<Record<string, unknown>>;
        const product = parts[0]?.product as
          | Record<string, unknown>
          | undefined;
        if (product)
          product.notes = {
            original: null,
            confirmed: { image: "架空禁止値" },
          };
      }),
      expectedCode: "invalid-structure",
      expectedPath: "$.data.parts[0].product.notes.confirmed.image",
    },
  ];
