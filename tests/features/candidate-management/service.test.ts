import assert from "node:assert/strict";
import test from "node:test";

import type {
  CandidatePart,
  CandidatePartId,
  LocalDataRoot,
  NormalizedAttributes,
  Project,
  ProjectId,
  RequestId,
  Revision,
  UtcTimestamp,
  Uuid,
} from "../../../src/domain/public.js";
import type {
  CandidateDraft,
  UpdateCandidateInput,
} from "../../../src/features/candidate-management/contracts.js";
import { createCandidateManagementService } from "../../../src/features/candidate-management/service.js";
import type {
  FoundationDataPort,
  RootMutationCommand,
} from "../../../src/persistence/public.js";

const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const requestId = "20000000-0000-4000-8000-000000000001" as Uuid as RequestId;
const timestamp = "2026-07-22T00:00:00.000Z" as UtcTimestamp;
const candidateId =
  "30000000-0000-4000-8000-000000000001" as Uuid as CandidatePartId;
const otherCandidateId =
  "30000000-0000-4000-8000-000000000002" as Uuid as CandidatePartId;
const otherProjectId =
  "10000000-0000-4000-8000-000000000002" as Uuid as ProjectId;
const uncategorizedCandidateId =
  "30000000-0000-4000-8000-000000000003" as Uuid as CandidatePartId;

const cpuAttributes = {
  category: "cpu",
  socket: { original: "架空ソケット", confirmed: "SYN-1" },
} satisfies NormalizedAttributes;

const memoryAttributes = {
  category: "memory",
  memoryStandard: { original: "架空規格", confirmed: "SYN-DDR" },
} satisfies NormalizedAttributes;

const draft = (overrides: Partial<CandidateDraft> = {}): CandidateDraft =>
  ({
    projectId,
    category: "cpu",
    product: { name: { original: "架空CPU", confirmed: "架空CPU" } },
    normalizedAttributes: cpuAttributes,
    ...overrides,
  }) as CandidateDraft;

const candidate = (
  id: CandidatePartId = candidateId,
  overrides: Partial<CandidatePart> = {},
): CandidatePart => ({
  id,
  projectId,
  category: "cpu",
  product: {
    name: { original: "抽出名", confirmed: "確認済みCPU" },
    manufacturer: { original: "抽出製造元", confirmed: "確認済み製造元" },
  },
  sourceInfo: {
    pageUrl: "https://catalog.example.invalid/cpu",
    siteName: "架空カタログ",
    capturedAt: timestamp,
  },
  sourceSnapshot: {
    name: "抽出名",
    manufacturer: "抽出製造元",
  },
  normalizedAttributes: cpuAttributes,
  createdAt: timestamp,
  updatedAt: timestamp,
  ...overrides,
});

const project = (name = "既存プロジェクト"): Project => ({
  id: projectId,
  name,
  createdAt: timestamp,
  updatedAt: timestamp,
});

const createData = (
  root: LocalDataRoot = {
    schemaVersion: 1,
    revision: 0 as Revision,
    projects: [project()],
    candidateParts: [],
    currentBuilds: [],
    requestDedupe: [],
    maintenance: { generation: 0 as never, active: false },
  },
): {
  readonly data: FoundationDataPort;
  readonly commands: RootMutationCommand[];
  readonly currentRoot: () => LocalDataRoot;
} => {
  const commands: RootMutationCommand[] = [];
  let currentRoot = root;
  const data = {
    async query<T>(query: (snapshot: LocalDataRoot) => T) {
      return { ok: true as const, value: query(currentRoot) };
    },
    async mutate(command: RootMutationCommand) {
      commands.push(command);
      const { operation } = command;
      if (operation.entity === "candidatePart" && operation.kind === "delete") {
        currentRoot = {
          ...currentRoot,
          candidateParts: currentRoot.candidateParts.filter(
            (candidate) => candidate.id !== operation.id,
          ),
        };
      }
      return {
        ok: true as const,
        value: {
          committedRevision: 1 as Revision,
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
  } as unknown as FoundationDataPort;
  return { data, commands, currentRoot: () => currentRoot };
};

test("プロジェクト作成・改名・削除はrequest IDとrevision付きの単一root mutationを使う", async () => {
  const { data, commands } = createData();
  const service = createCandidateManagementService({
    data,
    now: () => timestamp,
    createProjectId: () => projectId,
  });
  const context = { requestId, expectedRevision: 0 as Revision };

  const created = await service.createProject(
    { name: "  作成対象  " },
    context,
  );
  assert.equal(created.ok, true);
  if (created.ok) assert.equal(created.value.name, "作成対象");

  const renamed = await service.renameProject(
    { id: projectId, name: "  改名対象  " },
    context,
  );
  assert.deepEqual(renamed, { ok: true, value: project("改名対象") });

  const deleted = await service.deleteProject(projectId, context);
  assert.deepEqual(deleted, { ok: true, value: undefined });
  assert.equal(commands.length, 3);
  assert.deepEqual(
    commands.map(({ requestId: id, expectedRevision, operation }) => ({
      requestId: id,
      expectedRevision,
      operation,
    })),
    [
      {
        requestId,
        expectedRevision: 0,
        operation: {
          kind: "create",
          entity: "project",
          value: created.ok ? created.value : assert.fail(),
        },
      },
      {
        requestId,
        expectedRevision: 0,
        operation: {
          kind: "update",
          entity: "project",
          value: renamed.ok ? renamed.value : assert.fail(),
        },
      },
      {
        requestId,
        expectedRevision: 0,
        operation: { kind: "delete", entity: "project", id: projectId },
      },
    ],
  );
});

test("空白だけのプロジェクト名はmutation前に入力エラーとして拒否する", async () => {
  const { data, commands } = createData();
  const service = createCandidateManagementService({ data });
  const context = { requestId, expectedRevision: 0 as Revision };

  assert.deepEqual(await service.createProject({ name: " \t " }, context), {
    ok: false,
    error: { kind: "validation", fields: { name: "required" } },
  });
  assert.equal(commands.length, 0);
});

for (const [code, expected] of [
  ["revision-conflict", { kind: "conflict" }],
  ["maintenance-active", { kind: "maintenance" }],
  ["storage-unavailable", { kind: "storage" }],
] as const) {
  test(`${code}では既存rootを維持して正規化エラーを返す`, async () => {
    const root = [project()];
    const data = {
      async query<T>(query: (snapshot: LocalDataRoot) => T) {
        return {
          ok: true as const,
          value: query({
            schemaVersion: 1,
            revision: 0 as Revision,
            projects: root,
            candidateParts: [],
            currentBuilds: [],
            requestDedupe: [],
            maintenance: { generation: 0 as never, active: false },
          }),
        };
      },
      async mutate(_command: RootMutationCommand) {
        return { ok: false as const, error: { code } };
      },
    } as unknown as FoundationDataPort;
    const service = createCandidateManagementService({ data });

    const result = await service.renameProject(
      { id: projectId, name: "変更後" },
      { requestId, expectedRevision: 0 as Revision },
    );
    assert.deepEqual(result, { ok: false, error: expected });
    assert.deepEqual(root, [project()]);
  });
}

test("欠損を補完せずsourceSnapshotを保った未分類候補を単一projectへ作成する", async () => {
  const { data, commands } = createData();
  const service = createCandidateManagementService({
    data,
    now: () => timestamp,
    createCandidateId: () => candidateId,
  });
  const context = { requestId, expectedRevision: 0 as Revision };

  const result = await service.createCandidate(
    draft({
      category: "uncategorized",
      normalizedAttributes: { category: "uncategorized" },
      product: { name: { original: "調査中の部品" } },
      sourceSnapshot: { name: "調査中の部品", price: null },
    }),
    context,
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.id, candidateId);
    assert.equal(result.value.projectId, projectId);
    assert.equal(result.value.category, "uncategorized");
    assert.deepEqual(result.value.product, {
      name: { original: "調査中の部品" },
    });
    assert.equal("sourceInfo" in result.value, false);
    assert.deepEqual(result.value.sourceSnapshot, {
      name: "調査中の部品",
      price: null,
    });
  }
  assert.deepEqual(commands[0]?.operation, {
    kind: "create",
    entity: "candidatePart",
    value: result.ok ? result.value : assert.fail(),
  });
});

test("商品名が空の候補は項目エラーとしてmutation前に拒否する", async () => {
  const { data, commands } = createData();
  const service = createCandidateManagementService({ data });

  const result = await service.createCandidate(
    draft({ product: { name: { original: "  " } } }),
    { requestId, expectedRevision: 0 as Revision },
  );

  assert.deepEqual(result, {
    ok: false,
    error: { kind: "validation", fields: { "product.name": "required" } },
  });
  assert.equal(commands.length, 0);
});

test("カテゴリ変更は共通項目と取得元を保持し、新カテゴリ属性だけを明示入力へ置換する", async () => {
  const { data, commands } = createData({
    schemaVersion: 1,
    revision: 0 as Revision,
    projects: [project()],
    candidateParts: [candidate()],
    currentBuilds: [],
    requestDedupe: [],
    maintenance: { generation: 0 as never, active: false },
  });
  const service = createCandidateManagementService({
    data,
    now: () => timestamp,
  });
  const input: UpdateCandidateInput = {
    id: candidateId,
    draft: draft({
      projectId: otherProjectId,
      category: "memory",
      product: { name: { original: "上書きしてはいけない" } },
      sourceInfo: {
        pageUrl: "https://catalog.example.invalid/replaced",
        capturedAt: timestamp,
      },
      sourceSnapshot: { name: "上書きしてはいけない" },
      normalizedAttributes: memoryAttributes,
    }),
  };

  const result = await service.updateCandidate(input, {
    requestId,
    expectedRevision: 0 as Revision,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.projectId, projectId);
    assert.equal(result.value.category, "memory");
    assert.deepEqual(result.value.product, candidate().product);
    assert.deepEqual(result.value.sourceInfo, candidate().sourceInfo);
    assert.deepEqual(result.value.sourceSnapshot, candidate().sourceSnapshot);
    assert.deepEqual(result.value.normalizedAttributes, memoryAttributes);
  }
  assert.equal(commands.length, 1);
  assert.equal(commands[0]?.operation.entity, "candidatePart");
  assert.equal(commands[0]?.operation.kind, "update");
});

test("同一カテゴリ編集は明示値を反映し、省略された取得元情報を保持する", async () => {
  const existing = candidate();
  const { data } = createData({
    schemaVersion: 1,
    revision: 0 as Revision,
    projects: [project()],
    candidateParts: [existing],
    currentBuilds: [],
    requestDedupe: [],
    maintenance: { generation: 0 as never, active: false },
  });
  const service = createCandidateManagementService({
    data,
    now: () => timestamp,
  });
  const editedProduct = {
    name: { original: "編集後の元表記", confirmed: "編集後CPU" },
    modelNumber: { original: "SYN-EDIT", confirmed: "SYN-EDIT" },
  };

  const result = await service.updateCandidate(
    {
      id: candidateId,
      draft: draft({ product: editedProduct }),
    },
    { requestId, expectedRevision: 0 as Revision },
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value.product, editedProduct);
    assert.deepEqual(result.value.sourceInfo, existing.sourceInfo);
    assert.deepEqual(result.value.sourceSnapshot, existing.sourceSnapshot);
  }
});

test("同一カテゴリ編集は明示された取得元情報を入力どおり反映する", async () => {
  const { data } = createData({
    schemaVersion: 1,
    revision: 0 as Revision,
    projects: [project()],
    candidateParts: [candidate()],
    currentBuilds: [],
    requestDedupe: [],
    maintenance: { generation: 0 as never, active: false },
  });
  const service = createCandidateManagementService({
    data,
    now: () => timestamp,
  });
  const editedSourceInfo = { siteName: "編集後の架空カタログ" };
  const editedSourceSnapshot = { name: "編集後の元表記", price: null };

  const result = await service.updateCandidate(
    {
      id: candidateId,
      draft: draft({
        sourceInfo: editedSourceInfo,
        sourceSnapshot: editedSourceSnapshot,
      }),
    },
    { requestId, expectedRevision: 0 as Revision },
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value.sourceInfo, editedSourceInfo);
    assert.deepEqual(result.value.sourceSnapshot, editedSourceSnapshot);
  }
});

test("候補削除は単一mutationへ委譲し、他候補を対象にしない", async () => {
  const { data, commands, currentRoot } = createData({
    schemaVersion: 1,
    revision: 0 as Revision,
    projects: [project()],
    candidateParts: [candidate(), candidate(otherCandidateId)],
    currentBuilds: [],
    requestDedupe: [],
    maintenance: { generation: 0 as never, active: false },
  });
  const service = createCandidateManagementService({ data });

  const result = await service.deleteCandidate(candidateId, {
    requestId,
    expectedRevision: 0 as Revision,
  });

  assert.deepEqual(result, { ok: true, value: undefined });
  assert.deepEqual(
    commands.map((command) => command.operation),
    [{ kind: "delete", entity: "candidatePart", id: candidateId }],
  );
  assert.equal(
    commands.some((command) => command.operation.entity === "currentBuild"),
    false,
  );
  assert.deepEqual(
    currentRoot().candidateParts.map((candidate) => candidate.id),
    [otherCandidateId],
  );
});

test("候補照会はproject・category境界を守り、欠損を捏造しない", async () => {
  const otherProject: Project = {
    ...project("別プロジェクト"),
    id: otherProjectId,
  };
  const unclassified = candidate(uncategorizedCandidateId, {
    category: "uncategorized",
    normalizedAttributes: { category: "uncategorized" },
    product: { name: { original: "未分類の架空部品" } },
  });
  const { data } = createData({
    schemaVersion: 1,
    revision: 0 as Revision,
    projects: [project(), otherProject],
    candidateParts: [
      candidate(),
      unclassified,
      candidate(otherCandidateId, { projectId: otherProjectId }),
    ],
    currentBuilds: [],
    requestDedupe: [],
    maintenance: { generation: 0 as never, active: false },
  });
  const service = createCandidateManagementService({ data });

  assert.deepEqual(await service.listProjects(), {
    ok: true,
    value: [
      { id: projectId, name: "既存プロジェクト", updatedAt: timestamp },
      { id: otherProjectId, name: "別プロジェクト", updatedAt: timestamp },
    ],
  });
  assert.deepEqual(await service.listCandidates({ projectId }), {
    ok: true,
    value: [
      {
        id: candidateId,
        projectId,
        category: "cpu",
        name: { original: "抽出名", confirmed: "確認済みCPU" },
        manufacturer: { original: "抽出製造元", confirmed: "確認済み製造元" },
        hasMissingDetails: true,
        updatedAt: timestamp,
      },
      {
        id: uncategorizedCandidateId,
        projectId,
        category: "uncategorized",
        name: { original: "未分類の架空部品" },
        hasMissingDetails: true,
        updatedAt: timestamp,
      },
    ],
  });
  assert.deepEqual(
    await service.listCandidates({ projectId, category: "uncategorized" }),
    {
      ok: true,
      value: [
        {
          id: uncategorizedCandidateId,
          projectId,
          category: "uncategorized",
          name: { original: "未分類の架空部品" },
          hasMissingDetails: true,
          updatedAt: timestamp,
        },
      ],
    },
  );
  assert.deepEqual(await service.listBuildEligible(projectId), {
    ok: true,
    value: [candidate()],
  });
});
