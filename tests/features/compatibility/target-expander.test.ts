import assert from "node:assert/strict";
import test from "node:test";
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
import { targetExpander } from "../../../src/features/compatibility/target-expander.js";
import type { CurrentBuildSnapshot } from "../../../src/features/current-build/public.js";

const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const otherProjectId =
  "10000000-0000-4000-8000-000000000002" as Uuid as ProjectId;
const buildId =
  "40000000-0000-4000-8000-000000000001" as Uuid as CurrentBuild["id"];
const timestamp = "2026-07-22T00:00:00.000Z" as UtcTimestamp;

const partId = (raw: string): CandidatePartId =>
  raw as unknown as CandidatePartId;

const cpuId = partId("30000000-0000-4000-8000-000000000001");
const motherboardId = partId("30000000-0000-4000-8000-000000000002");
const memoryId1 = partId("30000000-0000-4000-8000-000000000003");
const memoryId2 = partId("30000000-0000-4000-8000-000000000004");
const coolerId = partId("30000000-0000-4000-8000-000000000005");
const caseId = partId("30000000-0000-4000-8000-000000000006");
const psuId = partId("30000000-0000-4000-8000-000000000007");
const uncategorizedId = partId("30000000-0000-4000-8000-000000000008");
const foreignId = partId("30000000-0000-4000-8000-000000000009");
const unlistedId = partId("30000000-0000-4000-8000-000000000010");
const unselectedMemoryId = partId("30000000-0000-4000-8000-000000000011");

const candidate = (
  id: CandidatePartId,
  overrides: Partial<CandidatePart> & {
    readonly category: CandidatePart["category"];
    readonly normalizedAttributes: NormalizedAttributes;
  },
): CandidatePart => ({
  id,
  projectId,
  product: {
    name: { original: `架空パーツ${id}`, confirmed: `架空パーツ${id}` },
  },
  createdAt: timestamp,
  updatedAt: timestamp,
  ...overrides,
});

const cpuCandidate = (id: CandidatePartId, socket?: string): CandidatePart =>
  candidate(id, {
    category: "cpu",
    normalizedAttributes: {
      category: "cpu",
      ...(socket !== undefined
        ? { socket: { original: "元表記", confirmed: socket } }
        : {}),
    },
  });

const motherboardCandidate = (
  id: CandidatePartId,
  fields: {
    socket?: string;
    memoryStandard?: string;
    formFactor?: string;
  } = {},
): CandidatePart =>
  candidate(id, {
    category: "motherboard",
    normalizedAttributes: {
      category: "motherboard",
      ...(fields.socket !== undefined
        ? { socket: { original: "元表記", confirmed: fields.socket } }
        : {}),
      ...(fields.memoryStandard !== undefined
        ? {
            memoryStandard: {
              original: "元表記",
              confirmed: fields.memoryStandard,
            },
          }
        : {}),
      ...(fields.formFactor !== undefined
        ? { formFactor: { original: "元表記", confirmed: fields.formFactor } }
        : {}),
    },
  });

const memoryCandidate = (
  id: CandidatePartId,
  memoryStandard?: string,
): CandidatePart =>
  candidate(id, {
    category: "memory",
    normalizedAttributes: {
      category: "memory",
      ...(memoryStandard !== undefined
        ? { memoryStandard: { original: "元表記", confirmed: memoryStandard } }
        : {}),
    },
  });

const coolerCandidate = (
  id: CandidatePartId,
  supportedSockets?: readonly string[],
): CandidatePart =>
  candidate(id, {
    category: "cpu-cooler",
    normalizedAttributes: {
      category: "cpu-cooler",
      ...(supportedSockets !== undefined
        ? {
            supportedSockets: {
              original: "元表記",
              confirmed: supportedSockets,
            },
          }
        : {}),
    },
  });

const caseCandidate = (
  id: CandidatePartId,
  fields: {
    supportedMotherboardFormFactors?: readonly string[];
    supportedPowerSupplyFormFactors?: readonly string[];
  } = {},
): CandidatePart =>
  candidate(id, {
    category: "case",
    normalizedAttributes: {
      category: "case",
      ...(fields.supportedMotherboardFormFactors !== undefined
        ? {
            supportedMotherboardFormFactors: {
              original: "元表記",
              confirmed: fields.supportedMotherboardFormFactors,
            },
          }
        : {}),
      ...(fields.supportedPowerSupplyFormFactors !== undefined
        ? {
            supportedPowerSupplyFormFactors: {
              original: "元表記",
              confirmed: fields.supportedPowerSupplyFormFactors,
            },
          }
        : {}),
    },
  });

const psuCandidate = (
  id: CandidatePartId,
  formFactor?: string,
): CandidatePart =>
  candidate(id, {
    category: "power-supply",
    normalizedAttributes: {
      category: "power-supply",
      ...(formFactor !== undefined
        ? { formFactor: { original: "元表記", confirmed: formFactor } }
        : {}),
    },
  });

const item = (
  candidatePartId: CandidatePartId,
  quantity = 1,
): CurrentBuild["items"][number] => ({
  candidatePartId,
  quantity: quantity as PositiveInteger,
});

const snapshotWith = (build: CurrentBuild | null): CurrentBuildSnapshot => ({
  revision: 1 as CurrentBuildSnapshot["revision"],
  currentBuild: build,
});

const fullBuild: CurrentBuild = {
  id: buildId,
  projectId,
  items: [
    item(cpuId),
    item(motherboardId),
    item(memoryId1),
    item(coolerId),
    item(caseId),
    item(psuId),
  ],
  updatedAt: timestamp,
};

const fullParts: readonly CandidatePart[] = [
  cpuCandidate(cpuId, "AM5"),
  motherboardCandidate(motherboardId, {
    socket: "AM5",
    memoryStandard: "DDR5",
    formFactor: "Micro-ATX",
  }),
  memoryCandidate(memoryId1, "DDR5"),
  coolerCandidate(coolerId, ["AM4", "AM5"]),
  caseCandidate(caseId, {
    supportedMotherboardFormFactors: ["ATX", "Micro-ATX"],
    supportedPowerSupplyFormFactors: ["ATX"],
  }),
  psuCandidate(psuId, "ATX"),
];

test("全5規則が現在構成の確認済み値から一つずつ判定対象を展開する", () => {
  const result = targetExpander.expand(snapshotWith(fullBuild), fullParts);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.value.length, 5);
  const byRule = new Map(result.value.map((target) => [target.ruleId, target]));

  const socketTarget = byRule.get("cpu-motherboard-socket");
  assert.ok(socketTarget);
  assert.deepEqual(socketTarget.left, {
    kind: "present",
    candidatePartId: cpuId,
    displayName: `架空パーツ${cpuId}`,
    value: "AM5",
  });
  assert.deepEqual(socketTarget.right, {
    kind: "present",
    candidatePartId: motherboardId,
    displayName: `架空パーツ${motherboardId}`,
    value: "AM5",
  });

  const coolerTarget = byRule.get("cooler-cpu-socket");
  assert.ok(coolerTarget);
  assert.deepEqual(coolerTarget.left, {
    kind: "present",
    candidatePartId: cpuId,
    displayName: `架空パーツ${cpuId}`,
    value: "AM5",
  });
  assert.deepEqual(coolerTarget.right, {
    kind: "present",
    candidatePartId: coolerId,
    displayName: `架空パーツ${coolerId}`,
    value: ["AM4", "AM5"],
  });

  const psuTarget = byRule.get("case-psu-form-factor");
  assert.ok(psuTarget);
  assert.deepEqual(psuTarget.left, {
    kind: "present",
    candidatePartId: psuId,
    displayName: `架空パーツ${psuId}`,
    value: "ATX",
  });
  assert.deepEqual(psuTarget.right, {
    kind: "present",
    candidatePartId: caseId,
    displayName: `架空パーツ${caseId}`,
    value: ["ATX"],
  });
});

test("同一カテゴリに複数の選択済み候補があれば各組み合わせへ展開する", () => {
  const build: CurrentBuild = {
    ...fullBuild,
    items: [
      ...fullBuild.items.filter((entry) => entry.candidatePartId !== memoryId1),
      item(memoryId1),
      item(memoryId2),
    ],
  };
  const parts: readonly CandidatePart[] = [
    ...fullParts,
    memoryCandidate(memoryId2, "DDR5"),
  ];

  const result = targetExpander.expand(snapshotWith(build), parts);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const ddrTargets = result.value.filter(
    (target) => target.ruleId === "motherboard-memory-ddr",
  );
  assert.equal(ddrTargets.length, 2);
  const rightIds = ddrTargets
    .map((target) =>
      target.right.kind === "present" ? target.right.candidatePartId : null,
    )
    .sort();
  assert.deepEqual(rightIds, [memoryId1, memoryId2].sort());
});

test("同一候補の数量が2以上でも一つの組み合わせとして扱う", () => {
  const build: CurrentBuild = {
    ...fullBuild,
    items: fullBuild.items.map((entry) =>
      entry.candidatePartId === memoryId1 ? item(memoryId1, 3) : entry,
    ),
  };

  const result = targetExpander.expand(snapshotWith(build), fullParts);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const ddrTargets = result.value.filter(
    (target) => target.ruleId === "motherboard-memory-ddr",
  );
  assert.equal(ddrTargets.length, 1);
});

test("現在構成に含まれない候補は対象展開へ含めない", () => {
  const parts: readonly CandidatePart[] = [
    ...fullParts,
    memoryCandidate(unselectedMemoryId, "DDR5"),
  ];

  const result = targetExpander.expand(snapshotWith(fullBuild), parts);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const ddrTargets = result.value.filter(
    (target) => target.ruleId === "motherboard-memory-ddr",
  );
  assert.equal(ddrTargets.length, 1);
  assert.ok(
    ddrTargets.every(
      (target) =>
        target.right.kind !== "present" ||
        target.right.candidatePartId !== unselectedMemoryId,
    ),
  );
});

test("片方のカテゴリが現在構成にないルールは不足対象として一件だけ返す", () => {
  const build: CurrentBuild = {
    ...fullBuild,
    items: fullBuild.items.filter(
      (entry) => entry.candidatePartId !== motherboardId,
    ),
  };

  const result = targetExpander.expand(snapshotWith(build), fullParts);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const socketTargets = result.value.filter(
    (target) => target.ruleId === "cpu-motherboard-socket",
  );
  assert.equal(socketTargets.length, 1);
  assert.deepEqual(socketTargets[0]?.left, {
    kind: "present",
    candidatePartId: cpuId,
    displayName: `架空パーツ${cpuId}`,
    value: "AM5",
  });
  assert.deepEqual(socketTargets[0]?.right, { kind: "absent" });

  const ddrTargets = result.value.filter(
    (target) => target.ruleId === "motherboard-memory-ddr",
  );
  assert.equal(ddrTargets.length, 1);
  assert.deepEqual(ddrTargets[0]?.left, { kind: "absent" });
});

test("現在構成が空のときは全5規則が両側欠如の不足対象を返す", () => {
  const build: CurrentBuild = { ...fullBuild, items: [] };

  const result = targetExpander.expand(snapshotWith(build), fullParts);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.value.length, 5);
  for (const target of result.value) {
    assert.deepEqual(target.left, { kind: "absent" });
    assert.deepEqual(target.right, { kind: "absent" });
  }
});

test("未確認の確認済み属性はabsentではなくvalue省略のpresentとして展開する", () => {
  const build: CurrentBuild = {
    ...fullBuild,
    items: [item(cpuId), item(motherboardId)],
  };
  const parts: readonly CandidatePart[] = [
    cpuCandidate(cpuId, "AM5"),
    motherboardCandidate(motherboardId),
  ];

  const result = targetExpander.expand(snapshotWith(build), parts);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const socketTarget = result.value.find(
    (target) => target.ruleId === "cpu-motherboard-socket",
  );
  assert.ok(socketTarget);
  assert.deepEqual(socketTarget.right, {
    kind: "present",
    candidatePartId: motherboardId,
    displayName: `架空パーツ${motherboardId}`,
  });
});

test("現在構成がなければno-buildを返す", () => {
  const result = targetExpander.expand(snapshotWith(null), fullParts);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "no-build");
});

test("存在しない候補への参照はinvalid-referenceとし全評価を停止する", () => {
  const build: CurrentBuild = {
    ...fullBuild,
    items: [item(unlistedId)],
  };

  const result = targetExpander.expand(snapshotWith(build), fullParts);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "invalid-reference");
});

test("別projectの候補への参照はinvalid-referenceとする", () => {
  const build: CurrentBuild = {
    ...fullBuild,
    items: [item(foreignId)],
  };
  const parts: readonly CandidatePart[] = [cpuCandidate(foreignId, "AM5")].map(
    (part) => ({ ...part, projectId: otherProjectId }),
  );

  const result = targetExpander.expand(snapshotWith(build), parts);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "invalid-reference");
});

test("未分類候補への参照はinvalid-referenceとする", () => {
  const build: CurrentBuild = {
    ...fullBuild,
    items: [item(uncategorizedId)],
  };
  const parts: readonly CandidatePart[] = [
    candidate(uncategorizedId, {
      category: "uncategorized",
      normalizedAttributes: { category: "uncategorized" },
    }),
  ];

  const result = targetExpander.expand(snapshotWith(build), parts);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "invalid-reference");
});

test("同じ入力に対して実行順序へ依存しない同一結果を返す", () => {
  const first = targetExpander.expand(snapshotWith(fullBuild), fullParts);
  const second = targetExpander.expand(snapshotWith(fullBuild), fullParts);
  assert.deepEqual(first, second);
});
