// @ts-nocheck 架空rootをTypeScript sourceへ直接渡して純粋policyを検証する。
import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import { schemaValidator } from "../../src/domain/validation.ts";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import { referenceRepairPolicy } from "../../src/persistence/reference-repair-policy.ts";

const ids = {
  project: "10000000-0000-4000-8000-000000000001",
  cpu: "20000000-0000-4000-8000-000000000001",
  gpu: "20000000-0000-4000-8000-000000000002",
  build: "30000000-0000-4000-8000-000000000001",
};
const timestamp = "2026-07-18T00:00:00Z";
const candidate = (id, category) => ({
  id,
  projectId: ids.project,
  category,
  product: {},
  sourceInfo: {
    pageUrl: "https://example.invalid/item",
    capturedAt: timestamp,
  },
  normalizedAttributes: { category },
  createdAt: timestamp,
  updatedAt: timestamp,
});
const root = () => ({
  schemaVersion: 1,
  revision: 0,
  projects: [
    {
      id: ids.project,
      name: "架空構成",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  candidateParts: [candidate(ids.cpu, "cpu"), candidate(ids.gpu, "gpu")],
  currentBuilds: [
    {
      id: ids.build,
      projectId: ids.project,
      items: [
        { candidatePartId: ids.cpu, quantity: 1 },
        { candidatePartId: ids.gpu, quantity: 2 },
      ],
      updatedAt: timestamp,
    },
  ],
  requestDedupe: [],
  maintenance: { generation: 0, active: false },
});

test("候補削除で対象build itemだけを除去し再検証できる", () => {
  const before = root();
  const proposed = {
    ...before,
    candidateParts: before.candidateParts.filter(({ id }) => id !== ids.cpu),
  };
  const snapshots = [structuredClone(before), structuredClone(proposed)];
  const result = referenceRepairPolicy.repair(before, proposed, {
    kind: "candidate-deleted",
    candidatePartId: ids.cpu,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.currentBuilds[0].items, [
    { candidatePartId: ids.gpu, quantity: 2 },
  ]);
  assert.equal(schemaValidator.validateRoot(result.value).ok, true);
  assert.deepEqual(before, snapshots[0]);
  assert.deepEqual(proposed, snapshots[1]);
});

test("カテゴリ変更で対象参照だけを除去し無関係な候補を保持する", () => {
  const before = root();
  const proposed = {
    ...before,
    candidateParts: before.candidateParts.map((part) =>
      part.id === ids.cpu ? candidate(ids.cpu, "other") : part,
    ),
  };
  const result = referenceRepairPolicy.repair(before, proposed, {
    kind: "candidate-category-changed",
    candidatePartId: ids.cpu,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.currentBuilds[0].items, [
    { candidatePartId: ids.gpu, quantity: 2 },
  ]);
  assert.equal(schemaValidator.validateRoot(result.value).ok, true);
});

test("無関係な変更ではrootと全参照をそのまま保持する", () => {
  const before = root();
  const proposed = {
    ...before,
    projects: [{ ...before.projects[0], name: "架空構成 更新" }],
  };
  const result = referenceRepairPolicy.repair(before, proposed, {
    kind: "unrelated",
  });
  assert.equal(result.ok, true);
  assert.equal(result.value, proposed);
  assert.deepEqual(result.value.currentBuilds, before.currentBuilds);
  assert.equal(schemaValidator.validateRoot(result.value).ok, true);
});
