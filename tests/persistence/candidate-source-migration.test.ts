import assert from "node:assert/strict";
import test from "node:test";

import { migrateCandidateSourcesV1ToV2 } from "../../src/persistence/candidate-source-migration.js";

const candidate = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: "22222222-2222-4222-8222-222222222222",
  projectId: "11111111-1111-4111-8111-111111111111",
  category: "cpu",
  product: {
    name: { original: "架空CPU" },
    price: {
      original: "12,345 JPY",
      confirmed: { amount: 12345, currency: "JPY" },
    },
  },
  sourceInfo: {
    pageUrl: "https://shop.example.invalid/cpu",
    siteName: "架空ショップ",
    capturedAt: "2026-07-28T01:02:03Z",
  },
  sourceSnapshot: { title: "架空CPU", price: "12,345 JPY" },
  normalizedAttributes: { category: "cpu" },
  createdAt: "2026-07-28T01:02:03Z",
  updatedAt: "2026-07-28T01:02:03Z",
  ...overrides,
});

const root = (candidates: readonly Record<string, unknown>[]) => ({
  schemaVersion: 1,
  revision: 7,
  projects: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "架空プロジェクト",
      createdAt: "2026-07-28T01:02:03Z",
      updatedAt: "2026-07-28T01:02:03Z",
    },
  ],
  candidateParts: candidates,
  currentBuilds: [],
  requestDedupe: [],
  maintenance: { generation: 0, active: false },
});

test("sourceInfoとpriceをcandidate IDのprimary sourceへ移す", () => {
  const input = root([candidate()]);
  const before = structuredClone(input);
  const result = migrateCandidateSourcesV1ToV2.migrate(input);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const output = result.value as ReturnType<typeof root>;
  assert.equal(output.schemaVersion, 2);
  const migrated = output.candidateParts.at(0);
  assert.ok(migrated);
  assert.deepEqual(migrated.sources, [
    {
      id: migrated.id,
      pageUrl: "https://shop.example.invalid/cpu",
      siteName: "架空ショップ",
      capturedAt: "2026-07-28T01:02:03Z",
      price: {
        original: "12,345 JPY",
        confirmed: { amount: 12345, currency: "JPY" },
      },
    },
  ]);
  assert.equal(migrated.primarySourceId, migrated.id);
  assert.equal("price" in (migrated.product as Record<string, unknown>), false);
  assert.equal("sourceInfo" in migrated, false);
  assert.deepEqual(
    migrated.sourceSnapshot,
    before.candidateParts[0]?.sourceSnapshot,
  );
  assert.deepEqual(input, before);
  assert.deepEqual(migrateCandidateSourcesV1ToV2.migrate(input), result);
});

test("sourceInfoかpriceの片方だけでも一件のsourceへ値を保持する", () => {
  const onlySource = candidate({ product: { name: { original: "架空CPU" } } });
  const onlyPrice = candidate({
    id: "33333333-3333-4333-8333-333333333333",
    sourceInfo: undefined,
  });
  delete onlyPrice.sourceInfo;
  const result = migrateCandidateSourcesV1ToV2.migrate(
    root([onlySource, onlyPrice]),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const candidates = (
    result.value as { candidateParts: Record<string, unknown>[] }
  ).candidateParts;
  assert.deepEqual(candidates[0]?.sources, [
    {
      id: onlySource.id,
      pageUrl: "https://shop.example.invalid/cpu",
      siteName: "架空ショップ",
      capturedAt: "2026-07-28T01:02:03Z",
    },
  ]);
  assert.deepEqual(candidates[1]?.sources, [
    {
      id: onlyPrice.id,
      price: (onlyPrice.product as { price: unknown }).price,
    },
  ]);
});

test("取得元もpriceもない候補はsourceなしへ移す", () => {
  const manual = candidate({ product: { name: { original: "手動CPU" } } });
  delete manual.sourceInfo;
  const result = migrateCandidateSourcesV1ToV2.migrate(root([manual]));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const migrated = (
    result.value as { candidateParts: Record<string, unknown>[] }
  ).candidateParts[0];
  assert.deepEqual(migrated?.sources, []);
  assert.equal("primarySourceId" in (migrated ?? {}), false);
});

test("不正な旧rootと不正な変換結果をvalidation errorとして返す", () => {
  const result = migrateCandidateSourcesV1ToV2.migrate({
    ...root([candidate()]),
    schemaVersion: 2,
  });
  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "validation",
      version: 1,
      issue: { code: "unsupported-schema", path: "$.schemaVersion" },
    },
  });
});
