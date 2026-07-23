import assert from "node:assert/strict";
import test from "node:test";
import type {
  CandidatePart,
  CandidatePartId,
  CurrentBuild,
  NormalizedAttributes,
  PositiveInteger,
  ProjectId,
  Result,
  UtcTimestamp,
  Uuid,
} from "../../../src/domain/public.js";
import type {
  CandidateQuery,
  ManagementError,
} from "../../../src/features/candidate-management/public.js";
import { createCompatibilityService } from "../../../src/features/compatibility/service.js";
import type {
  BuildError,
  CurrentBuildQuery,
  CurrentBuildSnapshot,
} from "../../../src/features/current-build/public.js";

const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const buildId =
  "40000000-0000-4000-8000-000000000001" as Uuid as CurrentBuild["id"];
const timestamp = "2026-07-22T00:00:00.000Z" as UtcTimestamp;

const partId = (raw: string): CandidatePartId =>
  raw as unknown as CandidatePartId;

const cpuId = partId("30000000-0000-4000-8000-000000000001");
const motherboardId = partId("30000000-0000-4000-8000-000000000002");
const memoryId = partId("30000000-0000-4000-8000-000000000003");
const coolerId = partId("30000000-0000-4000-8000-000000000004");
const caseId = partId("30000000-0000-4000-8000-000000000005");
const psuId = partId("30000000-0000-4000-8000-000000000006");
const unlistedId = partId("30000000-0000-4000-8000-000000000007");

const candidate = (
  id: CandidatePartId,
  category: CandidatePart["category"],
  normalizedAttributes: NormalizedAttributes,
): CandidatePart => ({
  id,
  projectId,
  category,
  product: {
    name: { original: `架空パーツ${id}`, confirmed: `架空パーツ${id}` },
  },
  normalizedAttributes,
  createdAt: timestamp,
  updatedAt: timestamp,
});

const cpu = (socket: string): CandidatePart =>
  candidate(cpuId, "cpu", {
    category: "cpu",
    socket: { original: "元表記", confirmed: socket },
  });

const motherboard = (socket: string): CandidatePart =>
  candidate(motherboardId, "motherboard", {
    category: "motherboard",
    socket: { original: "元表記", confirmed: socket },
    memoryStandard: { original: "元表記", confirmed: "DDR5" },
    formFactor: { original: "元表記", confirmed: "Micro-ATX" },
  });

const memory = (): CandidatePart =>
  candidate(memoryId, "memory", {
    category: "memory",
    memoryStandard: { original: "元表記", confirmed: "DDR5" },
  });

const cooler = (): CandidatePart =>
  candidate(coolerId, "cpu-cooler", {
    category: "cpu-cooler",
    supportedSockets: { original: "元表記", confirmed: ["AM4", "AM5"] },
  });

const pcCase = (): CandidatePart =>
  candidate(caseId, "case", {
    category: "case",
    supportedMotherboardFormFactors: {
      original: "元表記",
      confirmed: ["ATX", "Micro-ATX"],
    },
    supportedPowerSupplyFormFactors: { original: "元表記", confirmed: ["ATX"] },
  });

const psu = (): CandidatePart =>
  candidate(psuId, "power-supply", {
    category: "power-supply",
    formFactor: { original: "元表記", confirmed: "ATX" },
  });

const item = (
  candidatePartId: CandidatePartId,
): CurrentBuild["items"][number] => ({
  candidatePartId,
  quantity: 1 as PositiveInteger,
});

const fullBuild = (): CurrentBuild => ({
  id: buildId,
  projectId,
  items: [
    item(cpuId),
    item(motherboardId),
    item(memoryId),
    item(coolerId),
    item(caseId),
    item(psuId),
  ],
  updatedAt: timestamp,
});

const partsWith = (
  cpuSocket: string,
  motherboardSocket: string,
): readonly CandidatePart[] => [
  cpu(cpuSocket),
  motherboard(motherboardSocket),
  memory(),
  cooler(),
  pcCase(),
  psu(),
];

const buildQueryReturning = (
  result: Result<CurrentBuildSnapshot, BuildError>,
): CurrentBuildQuery & { calls: number } => {
  const query = {
    calls: 0,
    async getByProject() {
      query.calls += 1;
      return result;
    },
  };
  return query;
};

const candidateQueryReturning = (
  result: Result<readonly CandidatePart[], ManagementError>,
): CandidateQuery & { calls: number } => {
  const query = {
    calls: 0,
    async listProjects(): Promise<never> {
      throw new Error("not used by service tests");
    },
    async listCandidates(): Promise<never> {
      throw new Error("not used by service tests");
    },
    async listBuildEligible() {
      query.calls += 1;
      return result;
    },
    async getCandidateDraft(): Promise<never> {
      throw new Error("not used by service tests");
    },
  };
  return query;
};

const snapshotWith = (build: CurrentBuild | null): CurrentBuildSnapshot => ({
  revision: 1 as CurrentBuildSnapshot["revision"],
  currentBuild: build,
});

test("有効な入力から個別根拠と集約結果を持つreportを生成する", async () => {
  const build = fullBuild();
  const parts = partsWith("AM5", "AM5");
  const service = createCompatibilityService({
    currentBuildQuery: buildQueryReturning({
      ok: true,
      value: snapshotWith(build),
    }),
    candidateQuery: candidateQueryReturning({ ok: true, value: parts }),
  });

  const result = await service.evaluate(projectId);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.projectId, projectId);
  assert.equal(result.value.buildUpdatedAt, timestamp);
  assert.equal(result.value.status, "compatible");
  assert.equal(result.value.results.length, 5);
  assert.ok(result.value.results.every((r) => r.status === "compatible"));
});

test("非互換規則があれば集約結果へ反映する", async () => {
  const build = fullBuild();
  const parts = partsWith("AM5", "LGA1700");
  const service = createCompatibilityService({
    currentBuildQuery: buildQueryReturning({
      ok: true,
      value: snapshotWith(build),
    }),
    candidateQuery: candidateQueryReturning({ ok: true, value: parts }),
  });

  const result = await service.evaluate(projectId);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.status, "incompatible");
  const socketResult = result.value.results.find(
    (r) => r.ruleId === "cpu-motherboard-socket",
  );
  assert.equal(socketResult?.status, "incompatible");
});

test("現在構成がなければno-buildを返し候補照会を行わない", async () => {
  const candidateQuery = candidateQueryReturning({ ok: true, value: [] });
  const service = createCompatibilityService({
    currentBuildQuery: buildQueryReturning({
      ok: true,
      value: snapshotWith(null),
    }),
    candidateQuery,
  });

  const result = await service.evaluate(projectId);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "no-build");
  assert.equal(candidateQuery.calls, 0);
});

test("現在構成読取の破損はcorrupt-dataへ写像し結果statusと混同しない", async () => {
  const service = createCompatibilityService({
    currentBuildQuery: buildQueryReturning({
      ok: false,
      error: { kind: "corrupt-data" },
    }),
    candidateQuery: candidateQueryReturning({ ok: true, value: [] }),
  });

  const result = await service.evaluate(projectId);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "corrupt-data");
});

test("現在構成読取のその他失敗はread-failedへ写像する", async () => {
  const service = createCompatibilityService({
    currentBuildQuery: buildQueryReturning({
      ok: false,
      error: { kind: "maintenance" },
    }),
    candidateQuery: candidateQueryReturning({ ok: true, value: [] }),
  });

  const result = await service.evaluate(projectId);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "read-failed");
});

test("候補読取が非対応データならunsupported-dataへ写像する", async () => {
  const build = fullBuild();
  const service = createCompatibilityService({
    currentBuildQuery: buildQueryReturning({
      ok: true,
      value: snapshotWith(build),
    }),
    candidateQuery: candidateQueryReturning({
      ok: false,
      error: { kind: "unsupported-data" },
    }),
  });

  const result = await service.evaluate(projectId);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "unsupported-data");
});

test("候補読取のその他失敗はread-failedへ写像する", async () => {
  const build = fullBuild();
  const service = createCompatibilityService({
    currentBuildQuery: buildQueryReturning({
      ok: true,
      value: snapshotWith(build),
    }),
    candidateQuery: candidateQueryReturning({
      ok: false,
      error: { kind: "storage" },
    }),
  });

  const result = await service.evaluate(projectId);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "read-failed");
});

test("不正参照はinvalid-referenceとし結果statusと混同しない", async () => {
  const build: CurrentBuild = {
    ...fullBuild(),
    items: [item(unlistedId)],
  };
  const service = createCompatibilityService({
    currentBuildQuery: buildQueryReturning({
      ok: true,
      value: snapshotWith(build),
    }),
    candidateQuery: candidateQueryReturning({ ok: true, value: [] }),
  });

  const result = await service.evaluate(projectId);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "invalid-reference");
});

test("同じ入力から同じreportを再現し上流データを変更しない", async () => {
  const build = fullBuild();
  const parts = partsWith("AM5", "AM5");
  const partsSnapshot = JSON.parse(JSON.stringify(parts));
  const buildSnapshot = JSON.parse(JSON.stringify(build));

  const service = createCompatibilityService({
    currentBuildQuery: buildQueryReturning({
      ok: true,
      value: snapshotWith(build),
    }),
    candidateQuery: candidateQueryReturning({ ok: true, value: parts }),
  });

  const first = await service.evaluate(projectId);
  const second = await service.evaluate(projectId);

  assert.deepEqual(first, second);
  assert.deepEqual(parts, partsSnapshot);
  assert.deepEqual(build, buildSnapshot);
});
