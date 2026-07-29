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
  RequestId,
  Revision,
  UtcTimestamp,
  Uuid,
} from "../../../src/domain/public.js";
import type { CandidateQuery } from "../../../src/features/candidate-management/public.js";
import { createCategoryPolicy } from "../../../src/features/current-build/category-policy.js";
import type { BuildMutationContext } from "../../../src/features/current-build/contracts.js";
import { createCurrentBuildQuery } from "../../../src/features/current-build/query.js";
import { createBuildService } from "../../../src/features/current-build/service.js";
import type {
  FoundationScopedDataPort,
  RootMutationCommand,
} from "../../../src/persistence/public.js";

const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const requestId = "20000000-0000-4000-8000-000000000001" as Uuid as RequestId;
const timestamp = "2026-07-23T00:00:00.000Z" as UtcTimestamp;

const cpuCandidateId =
  "30000000-0000-4000-8000-000000000001" as Uuid as CandidatePartId;
const otherCpuCandidateId =
  "30000000-0000-4000-8000-000000000002" as Uuid as CandidatePartId;
const foreignCandidateId =
  "30000000-0000-4000-8000-000000000004" as Uuid as CandidatePartId;
const memoryCandidateId =
  "30000000-0000-4000-8000-000000000005" as Uuid as CandidatePartId;
const otherMemoryCandidateId =
  "30000000-0000-4000-8000-000000000006" as Uuid as CandidatePartId;

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
  revision: 0 as Revision,
  projects: [],
  candidateParts: [candidate(cpuCandidateId), candidate(otherCpuCandidateId)],
  currentBuilds: [],
  requestDedupe: [],
  maintenance: { generation: 0 as never, active: false },
  ...overrides,
});

interface Harness {
  readonly service: ReturnType<typeof createBuildService>;
  readonly commands: RootMutationCommand[];
  readonly currentRoot: () => LocalDataRoot;
}

const createHarness = (
  root: LocalDataRoot,
  options: {
    readonly mutateFailure?: { readonly code: string };
    readonly eligible?: readonly CandidatePart[];
  } = {},
): Harness => {
  let currentRoot = root;
  const commands: RootMutationCommand[] = [];
  const data: FoundationScopedDataPort = {
    async query<T>(query: (snapshot: LocalDataRoot) => T) {
      return { ok: true as const, value: query(currentRoot) };
    },
    async mutate(command: RootMutationCommand) {
      commands.push(command);
      if (options.mutateFailure !== undefined) {
        return { ok: false as const, error: options.mutateFailure };
      }
      const { operation } = command;
      if (operation.entity !== "currentBuild") {
        throw new Error("unexpected operation in service test");
      }
      if (operation.kind === "delete") {
        currentRoot = {
          ...currentRoot,
          currentBuilds: currentRoot.currentBuilds.filter(
            (build) => build.id !== operation.id,
          ),
          revision: (currentRoot.revision + 1) as Revision,
        };
      } else {
        const exists = currentRoot.currentBuilds.some(
          (build) => build.id === operation.value.id,
        );
        currentRoot = {
          ...currentRoot,
          currentBuilds: exists
            ? currentRoot.currentBuilds.map((build) =>
                build.id === operation.value.id ? operation.value : build,
              )
            : [...currentRoot.currentBuilds, operation.value],
          revision: (currentRoot.revision + 1) as Revision,
        };
      }
      return {
        ok: true as const,
        value: {
          committedRevision: currentRoot.revision,
          replayed: false,
          value: {
            capacity: {
              beforeBytes: 0,
              afterBytes: 0,
              requiredBytes: 0,
              quotaBytes: 1,
              warningThresholdBytes: 1,
              warnings: [],
            },
          },
        },
      };
    },
  } as unknown as FoundationScopedDataPort;

  const policy = createCategoryPolicy();
  const query = createCurrentBuildQuery({ data, policy });
  const eligible =
    options.eligible ??
    currentRoot.candidateParts.filter(
      (part) =>
        part.projectId === projectId && part.category !== "uncategorized",
    );
  const candidates: CandidateQuery = {
    async listProjects() {
      return { ok: true, value: [] };
    },
    async listCandidates() {
      return { ok: true, value: [] };
    },
    async listBuildEligible() {
      return { ok: true, value: eligible };
    },
    async getCandidateDraft() {
      throw new Error("not used by service tests");
    },
  };

  const service = createBuildService({
    data,
    policy,
    candidates,
    query,
    now: () => timestamp,
    createBuildId: () =>
      "40000000-0000-4000-8000-000000000001" as Uuid as CurrentBuild["id"],
  });

  return { service, commands, currentRoot: () => currentRoot };
};

const context = (expectedRevision: Revision): BuildMutationContext => ({
  requestId,
  expectedRevision,
});

test("未選択のCPUを選ぶと数量1で新しい構成を作成する", async () => {
  const { service, commands, currentRoot } = createHarness(rootWith());

  const result = await service.execute(
    { type: "select", projectId, candidatePartId: cpuCandidateId },
    context(0 as Revision),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.currentBuild?.items, [
    { candidatePartId: cpuCandidateId, quantity: 1 },
  ]);
  assert.equal(
    result.value.currentBuild?.id,
    currentRoot().currentBuilds[0]?.id,
  );
  assert.equal(commands.length, 1);
  assert.equal(commands[0]?.operation.kind, "create");
});

test("単一選択カテゴリで別候補を選ぶと以前の選択を置き換えIDを維持する", async () => {
  const existingBuild: CurrentBuild = {
    id: "40000000-0000-4000-8000-000000000001" as Uuid as CurrentBuild["id"],
    projectId,
    items: [
      { candidatePartId: cpuCandidateId, quantity: 1 as PositiveInteger },
    ],
    updatedAt: timestamp,
  };
  const { service, currentRoot } = createHarness(
    rootWith({ currentBuilds: [existingBuild], revision: 5 as Revision }),
  );

  const result = await service.execute(
    { type: "select", projectId, candidatePartId: otherCpuCandidateId },
    context(5 as Revision),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.currentBuild?.items, [
    { candidatePartId: otherCpuCandidateId, quantity: 1 },
  ]);
  assert.equal(result.value.currentBuild?.id, existingBuild.id);
  assert.equal(currentRoot().currentBuilds.length, 1);
});

test("単一選択カテゴリの選択解除は構成IDを維持しつつそのカテゴリを未選択にする", async () => {
  const existingBuild: CurrentBuild = {
    id: "40000000-0000-4000-8000-000000000001" as Uuid as CurrentBuild["id"],
    projectId,
    items: [
      { candidatePartId: cpuCandidateId, quantity: 1 as PositiveInteger },
    ],
    updatedAt: timestamp,
  };
  const { service } = createHarness(
    rootWith({ currentBuilds: [existingBuild], revision: 2 as Revision }),
  );

  const result = await service.execute(
    { type: "remove", projectId, candidatePartId: cpuCandidateId },
    context(2 as Revision),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.currentBuild?.items, []);
  assert.equal(result.value.currentBuild?.id, existingBuild.id);
});

test("単一選択カテゴリの数量変更要求は拒否され直前の構成が変化しない", async () => {
  const existingBuild: CurrentBuild = {
    id: "40000000-0000-4000-8000-000000000001" as Uuid as CurrentBuild["id"],
    projectId,
    items: [
      { candidatePartId: cpuCandidateId, quantity: 1 as PositiveInteger },
    ],
    updatedAt: timestamp,
  };
  const { service, commands, currentRoot } = createHarness(
    rootWith({ currentBuilds: [existingBuild], revision: 1 as Revision }),
  );

  const result = await service.execute(
    {
      type: "set-quantity",
      projectId,
      candidatePartId: cpuCandidateId,
      quantity: 2,
    },
    context(1 as Revision),
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "validation");
  assert.equal(commands.length, 0);
  assert.deepEqual(currentRoot().currentBuilds, [existingBuild]);
});

test("expected revisionが読込済みrevisionと異なれば競合として保存前に停止する", async () => {
  const existingBuild: CurrentBuild = {
    id: "40000000-0000-4000-8000-000000000001" as Uuid as CurrentBuild["id"],
    projectId,
    items: [
      { candidatePartId: cpuCandidateId, quantity: 1 as PositiveInteger },
    ],
    updatedAt: timestamp,
  };
  const { service, commands, currentRoot } = createHarness(
    rootWith({ currentBuilds: [existingBuild], revision: 9 as Revision }),
  );

  const result = await service.execute(
    { type: "select", projectId, candidatePartId: otherCpuCandidateId },
    context(3 as Revision),
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "conflict");
  assert.equal(commands.length, 0);
  assert.deepEqual(currentRoot().currentBuilds, [existingBuild]);
});

test("保存失敗時は再試行可能な理由を返し直前の構成を保持する", async () => {
  const { service, currentRoot } = createHarness(rootWith(), {
    mutateFailure: { code: "quota-exceeded" },
  });

  const result = await service.execute(
    { type: "select", projectId, candidatePartId: cpuCandidateId },
    context(0 as Revision),
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "quota");
  assert.equal(currentRoot().currentBuilds.length, 0);
});

test("同一projectの分類済み候補以外を選ぶとnot-foundとして拒否する", async () => {
  const { service, commands } = createHarness(
    rootWith({
      candidateParts: [
        candidate(cpuCandidateId),
        candidate(foreignCandidateId, {
          projectId:
            "10000000-0000-4000-8000-000000000099" as Uuid as ProjectId,
        }),
      ],
    }),
  );

  const result = await service.execute(
    { type: "select", projectId, candidatePartId: foreignCandidateId },
    context(0 as Revision),
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "not-found");
  assert.equal(commands.length, 0);
});

test("同一候補への再選択は冪等でありrevisionが変化しない限り追加mutationを行わない", async () => {
  const existingBuild: CurrentBuild = {
    id: "40000000-0000-4000-8000-000000000001" as Uuid as CurrentBuild["id"],
    projectId,
    items: [
      { candidatePartId: cpuCandidateId, quantity: 1 as PositiveInteger },
    ],
    updatedAt: timestamp,
  };
  const { service, commands } = createHarness(
    rootWith({ currentBuilds: [existingBuild], revision: 4 as Revision }),
  );

  const result = await service.execute(
    { type: "select", projectId, candidatePartId: cpuCandidateId },
    context(4 as Revision),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.currentBuild?.items, existingBuild.items);
  assert.equal(commands.length, 0);
});

test("複数選択カテゴリで候補を追加すると他の選択を維持して数量1で追加する", async () => {
  const existingBuild: CurrentBuild = {
    id: "40000000-0000-4000-8000-000000000001" as Uuid as CurrentBuild["id"],
    projectId,
    items: [
      { candidatePartId: cpuCandidateId, quantity: 1 as PositiveInteger },
      { candidatePartId: memoryCandidateId, quantity: 1 as PositiveInteger },
    ],
    updatedAt: timestamp,
  };
  const { service, commands } = createHarness(
    rootWith({
      candidateParts: [
        candidate(cpuCandidateId),
        candidate(memoryCandidateId, {
          category: "memory",
          normalizedAttributes: memoryAttributes,
        }),
        candidate(otherMemoryCandidateId, {
          category: "memory",
          normalizedAttributes: memoryAttributes,
        }),
      ],
      currentBuilds: [existingBuild],
      revision: 6 as Revision,
    }),
  );

  const result = await service.execute(
    { type: "select", projectId, candidatePartId: otherMemoryCandidateId },
    context(6 as Revision),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.currentBuild?.items, [
    { candidatePartId: cpuCandidateId, quantity: 1 },
    { candidatePartId: memoryCandidateId, quantity: 1 },
    { candidatePartId: otherMemoryCandidateId, quantity: 1 },
  ]);
  assert.equal(result.value.currentBuild?.id, existingBuild.id);
  assert.equal(commands[0]?.operation.kind, "update");
});

test("正整数の数量変更は他の選択を維持して指定数量を保存する", async () => {
  const existingBuild: CurrentBuild = {
    id: "40000000-0000-4000-8000-000000000001" as Uuid as CurrentBuild["id"],
    projectId,
    items: [
      { candidatePartId: cpuCandidateId, quantity: 1 as PositiveInteger },
      { candidatePartId: memoryCandidateId, quantity: 1 as PositiveInteger },
    ],
    updatedAt: timestamp,
  };
  const { service } = createHarness(
    rootWith({
      candidateParts: [
        candidate(cpuCandidateId),
        candidate(memoryCandidateId, {
          category: "memory",
          normalizedAttributes: memoryAttributes,
        }),
      ],
      currentBuilds: [existingBuild],
      revision: 7 as Revision,
    }),
  );

  const result = await service.execute(
    {
      type: "set-quantity",
      projectId,
      candidatePartId: memoryCandidateId,
      quantity: 4,
    },
    context(7 as Revision),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.currentBuild?.items, [
    { candidatePartId: cpuCandidateId, quantity: 1 },
    { candidatePartId: memoryCandidateId, quantity: 4 },
  ]);
});

test("複数選択カテゴリの候補を選択解除すると他の選択を維持して対象候補だけを除外する", async () => {
  const existingBuild: CurrentBuild = {
    id: "40000000-0000-4000-8000-000000000001" as Uuid as CurrentBuild["id"],
    projectId,
    items: [
      { candidatePartId: cpuCandidateId, quantity: 1 as PositiveInteger },
      { candidatePartId: memoryCandidateId, quantity: 3 as PositiveInteger },
      {
        candidatePartId: otherMemoryCandidateId,
        quantity: 2 as PositiveInteger,
      },
    ],
    updatedAt: timestamp,
  };
  const { service } = createHarness(
    rootWith({
      candidateParts: [
        candidate(cpuCandidateId),
        candidate(memoryCandidateId, {
          category: "memory",
          normalizedAttributes: memoryAttributes,
        }),
        candidate(otherMemoryCandidateId, {
          category: "memory",
          normalizedAttributes: memoryAttributes,
        }),
      ],
      currentBuilds: [existingBuild],
      revision: 8 as Revision,
    }),
  );

  const result = await service.execute(
    { type: "remove", projectId, candidatePartId: memoryCandidateId },
    context(8 as Revision),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.currentBuild?.items, [
    { candidatePartId: cpuCandidateId, quantity: 1 },
    { candidatePartId: otherMemoryCandidateId, quantity: 2 },
  ]);
});

test("同一候補の再追加は重複項目にせず単一の数量として保持する", async () => {
  const existingBuild: CurrentBuild = {
    id: "40000000-0000-4000-8000-000000000001" as Uuid as CurrentBuild["id"],
    projectId,
    items: [
      { candidatePartId: memoryCandidateId, quantity: 3 as PositiveInteger },
    ],
    updatedAt: timestamp,
  };
  const { service, commands } = createHarness(
    rootWith({
      candidateParts: [
        candidate(cpuCandidateId),
        candidate(memoryCandidateId, {
          category: "memory",
          normalizedAttributes: memoryAttributes,
        }),
      ],
      currentBuilds: [existingBuild],
      revision: 9 as Revision,
    }),
  );

  const result = await service.execute(
    { type: "select", projectId, candidatePartId: memoryCandidateId },
    context(9 as Revision),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.currentBuild?.items, [
    { candidatePartId: memoryCandidateId, quantity: 3 },
  ]);
  assert.equal(commands.length, 0);
});

test("不正な数量は保存前に拒否され既存の有効な構成を保持する", async () => {
  const existingBuild: CurrentBuild = {
    id: "40000000-0000-4000-8000-000000000001" as Uuid as CurrentBuild["id"],
    projectId,
    items: [
      { candidatePartId: memoryCandidateId, quantity: 2 as PositiveInteger },
    ],
    updatedAt: timestamp,
  };
  const { service, commands, currentRoot } = createHarness(
    rootWith({
      candidateParts: [
        candidate(cpuCandidateId),
        candidate(memoryCandidateId, {
          category: "memory",
          normalizedAttributes: memoryAttributes,
        }),
      ],
      currentBuilds: [existingBuild],
      revision: 10 as Revision,
    }),
  );

  for (const quantity of [0, -1, 1.5]) {
    const result = await service.execute(
      {
        type: "set-quantity",
        projectId,
        candidatePartId: memoryCandidateId,
        quantity,
      },
      context(10 as Revision),
    );

    assert.equal(result.ok, false);
    if (result.ok) continue;
    assert.equal(result.error.kind, "validation");
  }

  assert.equal(commands.length, 0);
  assert.deepEqual(currentRoot().currentBuilds, [existingBuild]);
});

test("選択対象外の候補への数量変更はnot-foundとして保存前に拒否する", async () => {
  const existingBuild: CurrentBuild = {
    id: "40000000-0000-4000-8000-000000000001" as Uuid as CurrentBuild["id"],
    projectId,
    items: [
      { candidatePartId: memoryCandidateId, quantity: 2 as PositiveInteger },
    ],
    updatedAt: timestamp,
  };
  const { service, commands, currentRoot } = createHarness(
    rootWith({
      candidateParts: [
        candidate(cpuCandidateId),
        candidate(memoryCandidateId, {
          category: "memory",
          normalizedAttributes: memoryAttributes,
        }),
      ],
      currentBuilds: [existingBuild],
      revision: 11 as Revision,
    }),
  );

  const result = await service.execute(
    {
      type: "set-quantity",
      projectId,
      candidatePartId: otherMemoryCandidateId,
      quantity: 2,
    },
    context(11 as Revision),
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "not-found");
  assert.equal(commands.length, 0);
  assert.deepEqual(currentRoot().currentBuilds, [existingBuild]);
});
