import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  CandidatePart,
  CandidatePartId,
  CurrentBuild,
  NormalizedAttributes,
  PositiveInteger,
  ProjectId,
  UtcTimestamp,
  Uuid,
} from "../../../src/domain/public.js";
import { createCategoryPolicy } from "../../../src/features/current-build/category-policy.js";
import { createCategorySummaries } from "../../../src/features/current-build/category-summary.js";
import { resolverFor } from "../../../src/ui-messages/public.js";

const timestamp = "2026-08-11T00:00:00.000Z" as UtcTimestamp;
const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const cpuId = "30000000-0000-4000-8000-000000000001" as Uuid as CandidatePartId;
const memoryAId =
  "30000000-0000-4000-8000-000000000002" as Uuid as CandidatePartId;
const memoryBId =
  "30000000-0000-4000-8000-000000000003" as Uuid as CandidatePartId;

const candidate = (
  id: CandidatePartId,
  category: "cpu" | "memory",
  name: string,
): CandidatePart => ({
  id,
  projectId,
  category,
  product: { name: { original: name, confirmed: name } },
  sources: [],
  normalizedAttributes: {
    category,
    ...(category === "cpu"
      ? { socket: { original: "架空", confirmed: "SYN-1" } }
      : { memoryStandard: { original: "架空", confirmed: "SYN-DDR" } }),
  } as NormalizedAttributes,
  createdAt: timestamp,
  updatedAt: timestamp,
});

const candidates = [
  candidate(cpuId, "cpu", "<b>架空CPU</b>"),
  candidate(memoryAId, "memory", "非常に長い架空メモリ A"),
  candidate(memoryBId, "memory", "架空メモリ B"),
];

const build: CurrentBuild = {
  id: "40000000-0000-4000-8000-000000000001" as Uuid as CurrentBuild["id"],
  projectId,
  items: [
    { candidatePartId: cpuId, quantity: 1 as PositiveInteger },
    { candidatePartId: memoryAId, quantity: 2 as PositiveInteger },
    { candidatePartId: memoryBId, quantity: 4 as PositiveInteger },
  ],
  updatedAt: timestamp,
};

test("全選択可能カテゴリをcanonical順でsingle・multiple・empty要約へ投影する", () => {
  const summaries = createCategorySummaries({
    candidates,
    currentBuild: build,
    policy: createCategoryPolicy(),
    messages: resolverFor("ja"),
  });

  assert.equal(summaries.length, 11);
  assert.deepEqual(
    summaries.map(({ category }) => category),
    [
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
    ],
  );
  assert.equal(summaries[0]?.displayText, "<b>架空CPU</b>");
  assert.equal(summaries[0]?.accessibleText, "CPU: <b>架空CPU</b>");
  assert.equal(
    summaries[3]?.displayText,
    "非常に長い架空メモリ A × 2、架空メモリ B × 4",
  );
  assert.equal(
    summaries[3]?.accessibleText,
    "メモリ: 非常に長い架空メモリ A、数量 2、架空メモリ B、数量 4",
  );
  assert.equal(summaries[1]?.displayText, "未選択");
  assert.equal(summaries[1]?.accessibleText, "CPUクーラー: 未選択");
  assert.equal(summaries[1]?.isEmpty, true);
});

test("英語でも同じ選択意味と完全な数量を表現する", () => {
  const summaries = createCategorySummaries({
    candidates,
    currentBuild: build,
    policy: createCategoryPolicy(),
    messages: resolverFor("en"),
  });
  const memory = summaries.find(({ category }) => category === "memory");

  assert.equal(
    memory?.displayText,
    "非常に長い架空メモリ A × 2, 架空メモリ B × 4",
  );
  assert.equal(
    memory?.accessibleText,
    "Memory: 非常に長い架空メモリ A, quantity 2, 架空メモリ B, quantity 4",
  );
});
