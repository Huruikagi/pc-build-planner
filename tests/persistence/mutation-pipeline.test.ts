// @ts-nocheck MutationPipeline境界をNode type strippingで直接検証する。
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    // Only project sources are type-stripped. A package resolves its own
    // `.js` specifiers against the files it actually ships.
    const typeStripped =
      specifier.endsWith(".js") &&
      !(context.parentURL ?? "").includes("/node_modules/");
    return nextResolve(
      typeStripped ? `${specifier.slice(0, -3)}.ts` : specifier,
      context,
    );
  },
});

const { createMutationPipeline } = await import(
  "../../src/persistence/mutation-pipeline.ts"
);
const { schemaValidator } = await import("../../src/domain/validation.ts");
const { referenceRepairPolicy } = await import(
  "../../src/persistence/reference-repair-policy.ts"
);

const ids = {
  project: "00000000-0000-4000-8000-000000000001",
  candidate: "00000000-0000-4000-8000-000000000002",
  source: "00000000-0000-4000-8000-000000000006",
  build: "00000000-0000-4000-8000-000000000003",
};
const now = "2026-07-19T00:00:00.000Z";
const project = {
  id: ids.project,
  name: "架空PC",
  createdAt: now,
  updatedAt: now,
};
const candidate = {
  id: ids.candidate,
  projectId: ids.project,
  category: "cpu",
  product: { name: { original: "架空CPU" } },
  sources: [
    {
      id: ids.source,
      pageUrl: "https://example.invalid/item",
      capturedAt: now,
    },
  ],
  primarySourceId: ids.source,
  normalizedAttributes: { category: "cpu", socket: { original: "架空Socket" } },
  createdAt: now,
  updatedAt: now,
};
const root = () => ({
  schemaVersion: 1,
  revision: 4,
  projects: [project],
  candidateParts: [candidate],
  currentBuilds: [
    {
      id: ids.build,
      projectId: ids.project,
      items: [{ candidatePartId: ids.candidate, quantity: 1 }],
      updatedAt: now,
    },
  ],
  requestDedupe: [],
  maintenance: { generation: 0, active: false },
});
const bytes = (value) =>
  new TextEncoder().encode(JSON.stringify({ localDataRoot: value })).byteLength;
const pipeline = createMutationPipeline(schemaValidator, referenceRepairPolicy);

test("CRUD候補を作りsnapshotのrevisionとdedupeを所有しない", () => {
  const nextProject = {
    ...project,
    id: "00000000-0000-4000-8000-000000000004",
    name: "予備",
  };
  const result = pipeline.apply(
    root(),
    { kind: "create", entity: "project", value: nextProject },
    { currentBytes: 100, quotaBytes: 10_000 },
  );
  assert.equal(result.ok, true);
  assert.equal(result.value.root.projects.at(-1).name, "予備");
  assert.equal(result.value.root.revision, 4);
  assert.deepEqual(result.value.root.requestDedupe, []);
  assert.equal(result.value.capacity.beforeBytes, 100);
});

test("candidate削除とcategory変更はbuild参照修復後にroot全体を再検証する", () => {
  for (const operation of [
    { kind: "delete", entity: "candidatePart", id: ids.candidate },
    {
      kind: "update",
      entity: "candidatePart",
      value: {
        ...candidate,
        category: "gpu",
        normalizedAttributes: { category: "gpu" },
      },
    },
  ]) {
    const result = pipeline.apply(root(), operation, {
      currentBytes: 0,
      quotaBytes: 10_000,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.value.root.currentBuilds[0].items, []);
  }
});

test("project削除は所属candidateとCurrentBuildを同じcommit候補から除去する", () => {
  const result = pipeline.apply(
    root(),
    { kind: "delete", entity: "project", id: ids.project },
    { currentBytes: 0, quotaBytes: 10_000 },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.value.root.projects, []);
  assert.deepEqual(result.value.root.candidateParts, []);
  assert.deepEqual(result.value.root.currentBuilds, []);
});

test("不正候補、存在済みcreate、存在しないupdate/deleteを決定的に拒否する", () => {
  const cases = [
    [
      { kind: "create", entity: "project", value: project },
      "entity-already-exists",
    ],
    [
      {
        kind: "update",
        entity: "project",
        value: { ...project, id: "00000000-0000-4000-8000-000000000099" },
      },
      "entity-not-found",
    ],
    [
      {
        kind: "delete",
        entity: "project",
        id: "00000000-0000-4000-8000-000000000099",
      },
      "entity-not-found",
    ],
    [
      { kind: "update", entity: "project", value: { ...project, name: 1 } },
      "validation",
    ],
  ];
  for (const [operation, code] of cases) {
    const result = pipeline.apply(root(), operation, {
      currentBytes: 0,
      quotaBytes: 10_000,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, code);
  }
});

test("runtime quotaからwarningを返し、超過時は候補rootを返さない", () => {
  const operation = {
    kind: "update",
    entity: "project",
    value: { ...project, name: "更新" },
  };
  const candidateRoot = { ...root(), projects: [{ ...project, name: "更新" }] };
  const required = bytes(candidateRoot);
  const warning = pipeline.apply(root(), operation, {
    currentBytes: 50,
    quotaBytes: required,
  });
  assert.equal(warning.ok, true);
  assert.deepEqual(warning.value.capacity.warnings, [
    { code: "capacity-warning", thresholdBytes: required * 0.8 },
  ]);
  const rejected = pipeline.apply(root(), operation, {
    currentBytes: 50,
    quotaBytes: required - 1,
  });
  assert.deepEqual(rejected, { ok: false, error: { code: "quota-exceeded" } });
});

test("root外controlの保持bytesをmutation後総量へ加える", () => {
  const operation = {
    kind: "update",
    entity: "project",
    value: { ...project, name: "更新" },
  };
  const beforeRootBytes = bytes(root());
  const candidateRoot = { ...root(), projects: [{ ...project, name: "更新" }] };
  const candidateRootBytes = bytes(candidateRoot);
  const retainedControlBytes = 60;

  const result = pipeline.apply(root(), operation, {
    currentBytes: beforeRootBytes + retainedControlBytes,
    currentRootBytes: beforeRootBytes,
    quotaBytes: candidateRootBytes + retainedControlBytes - 1,
  });

  assert.deepEqual(result, { ok: false, error: { code: "quota-exceeded" } });
});
