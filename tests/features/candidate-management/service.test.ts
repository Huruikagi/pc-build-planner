import assert from "node:assert/strict";
import test from "node:test";

import type {
  LocalDataRoot,
  Project,
  ProjectId,
  RequestId,
  Revision,
  UtcTimestamp,
  Uuid,
} from "../../../src/domain/public.js";
import { createCandidateManagementService } from "../../../src/features/candidate-management/service.js";
import type {
  FoundationDataPort,
  RootMutationCommand,
} from "../../../src/persistence/public.js";

const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const requestId = "20000000-0000-4000-8000-000000000001" as Uuid as RequestId;
const timestamp = "2026-07-22T00:00:00.000Z" as UtcTimestamp;

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
} => {
  const commands: RootMutationCommand[] = [];
  const data = {
    async query<T>(query: (snapshot: LocalDataRoot) => T) {
      return { ok: true as const, value: query(root) };
    },
    async mutate(command: RootMutationCommand) {
      commands.push(command);
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
  return { data, commands };
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
