import type {
  Revision,
  UtcTimestamp,
  Uuid,
} from "../../src/domain/identifiers.js";
import type {
  CandidatePart,
  CandidatePartId,
  CurrentBuildId,
  LocalDataRoot,
  MaintenanceGeneration,
  PositiveInteger,
  ProjectId,
} from "../../src/domain/model.js";
import type {
  NormalizedAttributes,
  PartCategory,
} from "../../src/domain/normalized-attributes.js";

const PART_CATEGORIES: readonly PartCategory[] = [
  "cpu",
  "cpu-cooler",
  "motherboard",
  "memory",
  "gpu",
  "storage",
  "power-supply",
  "case",
  "case-fan",
  "expansion-card",
  "other",
  "uncategorized",
];

const PROJECT_ID = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const BUILD_ID =
  "20000000-0000-4000-8000-000000000001" as Uuid as CurrentBuildId;
const CAPTURED_AT = "2026-07-19T00:00:00.000Z" as UtcTimestamp;

const candidateId = (index: number) =>
  `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}` as Uuid as CandidatePartId;

const attributesFor = (category: PartCategory): NormalizedAttributes => {
  switch (category) {
    case "cpu":
      return {
        category,
        socket: { original: "架空ソケット原表記", confirmed: "SYN-1" },
      };
    case "cpu-cooler":
      return {
        category,
        supportedSockets: { original: "架空対応一覧", confirmed: ["SYN-1"] },
      };
    case "motherboard":
      return {
        category,
        socket: { original: "架空ソケット原表記", confirmed: "SYN-1" },
        memoryStandard: { original: "架空メモリ規格", confirmed: "SYN-DDR" },
        formFactor: { original: "架空基板規格", confirmed: "SYN-BOARD" },
      };
    case "memory":
      return {
        category,
        memoryStandard: { original: "架空メモリ規格", confirmed: "SYN-DDR" },
      };
    case "power-supply":
      return {
        category,
        formFactor: { original: "架空電源規格", confirmed: "SYN-PSU" },
      };
    case "case":
      return {
        category,
        supportedMotherboardFormFactors: {
          original: "架空基板対応",
          confirmed: ["SYN-BOARD"],
        },
        supportedPowerSupplyFormFactors: {
          original: "架空電源対応",
          confirmed: ["SYN-PSU"],
        },
      };
    default:
      return { category };
  }
};

/** すべての値が架空で、全categoryを一つのproject/buildへ整合参照させる。 */
export const buildFoundationRoot = (): LocalDataRoot => {
  const candidateParts: CandidatePart[] = PART_CATEGORIES.map(
    (category, index) => ({
      id: candidateId(index),
      projectId: PROJECT_ID,
      category,
      product: {
        name: {
          original: `${category === "cpu" ? "架空CPU" : `架空${category}`} 原表記`,
          confirmed: `${category === "cpu" ? "架空CPU" : `架空${category}`} 確認値`,
        },
        manufacturer: { original: "架空製造元", confirmed: "Synthetic Works" },
        modelNumber: {
          original: `架空型番-${index + 1}`,
          confirmed: `SYN-${index + 1}`,
        },
        price: {
          original: "架空価格",
          confirmed: { amount: 1000 + index, currency: "SYN" },
        },
        notes: { original: null, confirmed: "架空注記" },
      },
      sourceInfo: {
        pageUrl: `https://catalog.example.invalid/synthetic-part-${index + 1}`,
        siteName: "架空部品カタログ",
        capturedAt: CAPTURED_AT,
      },
      normalizedAttributes: attributesFor(category),
      createdAt: CAPTURED_AT,
      updatedAt: CAPTURED_AT,
    }),
  );
  return {
    schemaVersion: 1,
    revision: 1 as Revision,
    projects: [
      {
        id: PROJECT_ID,
        name: "架空PC構成",
        createdAt: CAPTURED_AT,
        updatedAt: CAPTURED_AT,
      },
    ],
    candidateParts,
    currentBuilds: [
      {
        id: BUILD_ID,
        projectId: PROJECT_ID,
        items: candidateParts.map(({ id }) => ({
          candidatePartId: id,
          quantity: 1 as PositiveInteger,
        })),
        updatedAt: CAPTURED_AT,
      },
    ],
    requestDedupe: [],
    maintenance: { generation: 0 as MaintenanceGeneration, active: false },
  } satisfies LocalDataRoot;
};

export const buildMissingProductFieldsRoot = (): LocalDataRoot => {
  const root = structuredClone(buildFoundationRoot());
  return {
    ...root,
    candidateParts: root.candidateParts.map((candidate, index) =>
      index === 0 ? { ...candidate, product: {} } : candidate,
    ),
  };
};

export interface CorruptFoundationRoot {
  readonly name: string;
  readonly root: unknown;
  readonly expectedCode: string;
  readonly expectedPath: string;
}

const corrupted = (change: (root: Record<string, unknown>) => void) => {
  const root = structuredClone(buildFoundationRoot()) as unknown as Record<
    string,
    unknown
  >;
  change(root);
  return root;
};

/** validator境界専用。破損値も実サイトassetを一切含まない。 */
export const buildCorruptFoundationRoots =
  (): readonly CorruptFoundationRoot[] => [
    {
      name: "schema version",
      root: corrupted((root) => {
        root.schemaVersion = 99;
      }),
      expectedCode: "unsupported-schema",
      expectedPath: "$.schemaVersion",
    },
    {
      name: "missing project reference",
      root: corrupted((root) => {
        const candidates = root.candidateParts as Array<
          Record<string, unknown>
        >;
        if (candidates[0])
          candidates[0].projectId = "90000000-0000-4000-8000-000000000001";
      }),
      expectedCode: "missing-reference",
      expectedPath: "$.candidateParts[0].projectId",
    },
    {
      name: "category mismatch",
      root: corrupted((root) => {
        const candidates = root.candidateParts as Array<
          Record<string, unknown>
        >;
        if (candidates[0])
          candidates[0].normalizedAttributes = { category: "gpu" };
      }),
      expectedCode: "category-mismatch",
      expectedPath: "$.candidateParts[0].normalizedAttributes.category",
    },
    {
      name: "invalid build quantity",
      root: corrupted((root) => {
        const builds = root.currentBuilds as Array<Record<string, unknown>>;
        const items = builds[0]?.items as
          | Array<Record<string, unknown>>
          | undefined;
        if (items?.[0]) items[0].quantity = 0;
      }),
      expectedCode: "invalid-positive-integer",
      expectedPath: "$.currentBuilds[0].items[0].quantity",
    },
  ];
