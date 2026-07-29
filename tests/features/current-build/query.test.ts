import assert from "node:assert/strict";
import test from "node:test";

import type {
  CandidatePart,
  CandidatePartId,
  CurrentBuild,
  LocalDataRoot,
  NormalizedAttributes,
  PositiveInteger,
  ProjectId,
  Revision,
  UtcTimestamp,
  Uuid,
} from "../../../src/domain/public.js";
import { createCategoryPolicy } from "../../../src/features/current-build/category-policy.js";
import { createCurrentBuildQuery } from "../../../src/features/current-build/query.js";
import type { FoundationScopedDataPort } from "../../../src/persistence/public.js";

const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const otherProjectId =
  "10000000-0000-4000-8000-000000000002" as Uuid as ProjectId;
const buildId =
  "40000000-0000-4000-8000-000000000001" as Uuid as CurrentBuild["id"];
const cpuCandidateId =
  "30000000-0000-4000-8000-000000000001" as Uuid as CandidatePartId;
const otherCpuCandidateId =
  "30000000-0000-4000-8000-000000000002" as Uuid as CandidatePartId;
const memoryCandidateId =
  "30000000-0000-4000-8000-000000000003" as Uuid as CandidatePartId;
const uncategorizedCandidateId =
  "30000000-0000-4000-8000-000000000004" as Uuid as CandidatePartId;
const foreignCandidateId =
  "30000000-0000-4000-8000-000000000005" as Uuid as CandidatePartId;
const timestamp = "2026-07-22T00:00:00.000Z" as UtcTimestamp;

const cpuAttributes = {
  category: "cpu",
  socket: { original: "架空ソケット", confirmed: "SYN-1" },
} satisfies NormalizedAttributes;

const memoryAttributes = {
  category: "memory",
  memoryStandard: { original: "架空規格", confirmed: "SYN-DDR" },
} satisfies NormalizedAttributes;

const candidate = (
  id: CandidatePartId,
  overrides: Partial<CandidatePart> = {},
): CandidatePart =>
  ({
    id,
    projectId,
    category: "cpu",
    product: { name: { original: "架空CPU", confirmed: "架空CPU" } },
    sources: [],
    normalizedAttributes: cpuAttributes,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  }) as CandidatePart;

const rootWith = (overrides: Partial<LocalDataRoot> = {}): LocalDataRoot => ({
  schemaVersion: 1,
  revision: 3 as Revision,
  projects: [],
  candidateParts: [],
  currentBuilds: [],
  requestDedupe: [],
  maintenance: { generation: 0 as never, active: false },
  ...overrides,
});

const dataPortFor = (root: LocalDataRoot): FoundationScopedDataPort =>
  ({
    async query<T>(query: (snapshot: LocalDataRoot) => T) {
      return { ok: true as const, value: query(root) };
    },
    async mutate() {
      throw new Error("not used by query tests");
    },
  }) as unknown as FoundationScopedDataPort;

const createQuery = (root: LocalDataRoot) =>
  createCurrentBuildQuery({
    data: dataPortFor(root),
    policy: createCategoryPolicy(),
  });

test("構成が存在しないprojectは正常な空結果を返す", async () => {
  const query = createQuery(
    rootWith({ candidateParts: [candidate(cpuCandidateId)] }),
  );

  const result = await query.getByProject(projectId);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.currentBuild, null);
  assert.equal(result.value.revision, 3);
});

test("単一・複数選択の有効な構成をそのまま返す", async () => {
  const build: CurrentBuild = {
    id: buildId,
    projectId,
    items: [
      { candidatePartId: cpuCandidateId, quantity: 1 as PositiveInteger },
      { candidatePartId: memoryCandidateId, quantity: 2 as PositiveInteger },
    ],
    updatedAt: timestamp,
  };
  const query = createQuery(
    rootWith({
      candidateParts: [
        candidate(cpuCandidateId),
        candidate(memoryCandidateId, {
          category: "memory",
          normalizedAttributes: memoryAttributes,
        }),
      ],
      currentBuilds: [build],
    }),
  );

  const result = await query.getByProject(projectId);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.currentBuild, build);
});

test("同一projectに複数構成があればcorrupt-dataとして操作を停止する", async () => {
  const buildA: CurrentBuild = {
    id: buildId,
    projectId,
    items: [],
    updatedAt: timestamp,
  };
  const buildB: CurrentBuild = {
    ...buildA,
    id: "40000000-0000-4000-8000-000000000002" as Uuid as CurrentBuild["id"],
  };
  const query = createQuery(rootWith({ currentBuilds: [buildA, buildB] }));

  const result = await query.getByProject(projectId);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "corrupt-data");
});

test("重複した候補参照はcorrupt-dataとして採用品を表示しない", async () => {
  const build: CurrentBuild = {
    id: buildId,
    projectId,
    items: [
      { candidatePartId: memoryCandidateId, quantity: 1 as PositiveInteger },
      { candidatePartId: memoryCandidateId, quantity: 2 as PositiveInteger },
    ],
    updatedAt: timestamp,
  };
  const query = createQuery(
    rootWith({
      candidateParts: [
        candidate(memoryCandidateId, {
          category: "memory",
          normalizedAttributes: memoryAttributes,
        }),
      ],
      currentBuilds: [build],
    }),
  );

  const result = await query.getByProject(projectId);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "corrupt-data");
});

test("単一選択カテゴリで二件以上選ばれていればcorrupt-dataとする", async () => {
  const build: CurrentBuild = {
    id: buildId,
    projectId,
    items: [
      { candidatePartId: cpuCandidateId, quantity: 1 as PositiveInteger },
      { candidatePartId: otherCpuCandidateId, quantity: 1 as PositiveInteger },
    ],
    updatedAt: timestamp,
  };
  const query = createQuery(
    rootWith({
      candidateParts: [
        candidate(cpuCandidateId),
        candidate(otherCpuCandidateId),
      ],
      currentBuilds: [build],
    }),
  );

  const result = await query.getByProject(projectId);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "corrupt-data");
});

test("未分類候補への参照はcorrupt-dataとする", async () => {
  const build: CurrentBuild = {
    id: buildId,
    projectId,
    items: [
      {
        candidatePartId: uncategorizedCandidateId,
        quantity: 1 as PositiveInteger,
      },
    ],
    updatedAt: timestamp,
  };
  const query = createQuery(
    rootWith({
      candidateParts: [
        candidate(uncategorizedCandidateId, {
          category: "uncategorized",
          normalizedAttributes: {
            category: "uncategorized",
          } as NormalizedAttributes,
        }),
      ],
      currentBuilds: [build],
    }),
  );

  const result = await query.getByProject(projectId);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "corrupt-data");
});

test("別projectの候補参照はcorrupt-dataとし他projectのqueryへ影響しない", async () => {
  const build: CurrentBuild = {
    id: buildId,
    projectId,
    items: [
      { candidatePartId: foreignCandidateId, quantity: 1 as PositiveInteger },
    ],
    updatedAt: timestamp,
  };
  const query = createQuery(
    rootWith({
      candidateParts: [
        candidate(foreignCandidateId, { projectId: otherProjectId }),
      ],
      currentBuilds: [build],
    }),
  );

  const result = await query.getByProject(projectId);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "corrupt-data");
});

test("query失敗時はFoundationエラーを利用者が扱えるBuildErrorへ写像する", async () => {
  const data: FoundationScopedDataPort = {
    async query() {
      return { ok: false as const, error: { code: "maintenance-active" } };
    },
    async mutate() {
      throw new Error("not used by query tests");
    },
  } as unknown as FoundationScopedDataPort;
  const query = createCurrentBuildQuery({
    data,
    policy: createCategoryPolicy(),
  });

  const result = await query.getByProject(projectId);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "maintenance");
});
