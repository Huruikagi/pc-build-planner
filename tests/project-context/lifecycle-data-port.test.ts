import assert from "node:assert/strict";
import test from "node:test";
import type {
  FoundationError,
  Project,
  ProjectId,
  RequestId,
  Result,
  Revision,
  UtcTimestamp,
  Uuid,
} from "../../src/domain/public.js";
import type {
  FoundationScopedDataPort,
  MutationReceipt,
  RootMutationCommand,
} from "../../src/persistence/public.js";
import { createFoundationProjectLifecycleDataPort } from "../../src/project-context/lifecycle-data-port.js";

const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const requestId = "50000000-0000-4000-8000-000000000001" as Uuid as RequestId;
const timestamp = "2026-08-13T00:00:00.000Z" as UtcTimestamp;
const project: Project = {
  id: projectId,
  name: "Synthetic build",
  createdAt: timestamp,
  updatedAt: timestamp,
};

const successReceipt = (revision: number): MutationReceipt => ({
  committedRevision: revision as Revision,
  replayed: false,
  value: {
    capacity: {
      beforeBytes: 1,
      afterBytes: 1,
      requiredBytes: 1,
      quotaBytes: 10,
      warningThresholdBytes: 8,
      warnings: [],
    },
  },
});

test("最新revisionのcontextとproject lookupだけを公開する", async () => {
  const queries: string[] = [];
  const foundation: FoundationScopedDataPort = {
    async query(query) {
      queries.push("query");
      return {
        ok: true,
        value: query({ revision: 7, projects: [project] } as never),
      };
    },
    async mutate() {
      throw new Error("mutation not expected");
    },
  };
  const port = createFoundationProjectLifecycleDataPort(
    foundation,
    () => requestId,
  );

  assert.deepEqual(await port.createMutationContext(), {
    ok: true,
    value: { requestId, expectedRevision: 7 },
  });
  assert.deepEqual(await port.find(projectId), { ok: true, value: project });
  assert.equal(queries.length, 2);
});

test("create/update/deleteをproject mutationへ一回だけ変換しcommit revisionだけを返す", async () => {
  const commands: RootMutationCommand[] = [];
  const foundation: FoundationScopedDataPort = {
    async query() {
      throw new Error("query not expected");
    },
    async mutate(command) {
      commands.push(command);
      return { ok: true, value: successReceipt(4) };
    },
  };
  const port = createFoundationProjectLifecycleDataPort(
    foundation,
    () => requestId,
  );
  const context = { requestId, expectedRevision: 3 as Revision };

  for (const operation of [
    { kind: "create", project },
    { kind: "update", project },
    { kind: "delete", projectId },
  ] as const) {
    assert.deepEqual(await port.mutate(operation, context), {
      ok: true,
      value: { revision: 4, replayed: false },
    });
  }
  assert.deepEqual(
    commands.map((command) => command.operation),
    [
      { kind: "create", entity: "project", value: project },
      { kind: "update", entity: "project", value: project },
      { kind: "delete", entity: "project", id: projectId },
    ],
  );
});

test("foundation failureを値非保持の安定したlifecycle errorへ閉じる", async () => {
  const cases = [
    ["revision-conflict", "conflict"],
    ["request-conflict", "conflict"],
    ["maintenance-active", "maintenance"],
    ["recovery-active", "maintenance"],
    ["access-denied", "storage"],
    ["lock-unavailable", "storage"],
    ["storage-unavailable", "storage"],
    ["quota-exceeded", "quota"],
    ["validation", "unsupported-data"],
    ["corrupt-data", "unsupported-data"],
    ["unsupported-version", "unsupported-data"],
    ["migration-failed", "unsupported-data"],
    ["repair-failed", "unsupported-data"],
    ["stale-recovery-state", "unsupported-data"],
    ["stale-fence", "unsupported-data"],
    ["stale-assessment", "unsupported-data"],
    ["precommit-cleanup-pending", "unsupported-data"],
  ] as const;

  for (const [code, kind] of cases) {
    const failure: Result<never, FoundationError> = {
      ok: false,
      error: { code, message: "secret persisted value" } as FoundationError,
    };
    const foundation: FoundationScopedDataPort = {
      async query() {
        return failure;
      },
      async mutate() {
        return failure;
      },
    };
    const port = createFoundationProjectLifecycleDataPort(
      foundation,
      () => requestId,
    );
    assert.deepEqual(await port.find(projectId), {
      ok: false,
      error: { kind },
    });
    assert.deepEqual(
      await port.mutate(
        { kind: "delete", projectId },
        { requestId, expectedRevision: 0 as Revision },
      ),
      { ok: false, error: { kind } },
    );
  }
});

test("missing lookup returns undefined without exposing the requested id", async () => {
  const foundation: FoundationScopedDataPort = {
    async query(query) {
      return { ok: true, value: query({ projects: [], revision: 0 } as never) };
    },
    async mutate() {
      throw new Error("mutation not expected");
    },
  };
  const port = createFoundationProjectLifecycleDataPort(
    foundation,
    () => requestId,
  );
  assert.deepEqual(await port.find(projectId), { ok: true, value: undefined });
});

test("foundation promise rejection is sanitized for query, context, and mutation", async () => {
  const secret = `${project.name}:${projectId}:persisted-value`;
  const foundation: FoundationScopedDataPort = {
    async query() {
      throw new Error(secret);
    },
    async mutate() {
      throw { message: secret, stored: project };
    },
  };
  const port = createFoundationProjectLifecycleDataPort(
    foundation,
    () => requestId,
  );

  const results = [
    await port.createMutationContext(),
    await port.find(projectId),
    await port.mutate(
      { kind: "delete", projectId },
      { requestId, expectedRevision: 0 as Revision },
    ),
  ];
  assert.deepEqual(results, [
    { ok: false, error: { kind: "storage" } },
    { ok: false, error: { kind: "storage" } },
    { ok: false, error: { kind: "storage" } },
  ]);
  assert.doesNotMatch(JSON.stringify(results), new RegExp(projectId));
  assert.doesNotMatch(
    JSON.stringify(results),
    /Synthetic build|persisted-value/,
  );
});
