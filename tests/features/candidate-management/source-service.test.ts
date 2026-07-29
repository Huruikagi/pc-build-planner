import assert from "node:assert/strict";
import test from "node:test";
import type {
  CandidatePartId,
  CandidateSourceId,
  LocalDataRoot,
  RequestId,
  Revision,
  UtcTimestamp,
} from "../../../src/domain/public.js";
import type { CandidateDraft } from "../../../src/features/candidate-management/contracts.js";
import { createCandidateManagementService } from "../../../src/features/candidate-management/service.js";
import type { CandidateSourceDataPort } from "../../../src/features/candidate-management/source-data-port.js";
import type {
  FoundationScopedDataPort,
  RootMutationCommand,
} from "../../../src/persistence/public.js";
import { sourceRoot } from "../../fixtures/candidate-source-root.js";

const candidateId = "20000000-0000-4000-8000-000000000001" as CandidatePartId;
const context = {
  requestId: "40000000-0000-4000-8000-000000000001" as RequestId,
  expectedRevision: 1,
};

const harness = (failure?: string) => {
  let root = sourceRoot();
  const commands: RootMutationCommand[] = [];
  const data = {
    async query(project: (root: never) => unknown) {
      return { ok: true as const, value: project(root as never) };
    },
    async mutate(command: RootMutationCommand) {
      commands.push(command);
      if (failure) return { ok: false as const, error: { code: failure } };
      const operation = command.operation;
      if (operation.kind === "update" && operation.entity === "candidatePart") {
        root = {
          ...root,
          revision: 2 as Revision,
          candidateParts: root.candidateParts.map((candidate) =>
            candidate.id === operation.value.id
              ? (operation.value as unknown as LocalDataRoot["candidateParts"][number])
              : candidate,
          ),
        };
      }
      return { ok: true as const, value: {} as never };
    },
  } as FoundationScopedDataPort;
  const sourceData: CandidateSourceDataPort = {
    async query(project) {
      return { ok: true, value: project(root) };
    },
    async mutateCandidate(candidate) {
      commands.push({ operation: { value: candidate } } as never);
      if (failure) return { ok: false, error: { code: failure } };
      const exists = root.candidateParts.some(
        (current) => current.id === candidate.id,
      );
      root = {
        ...root,
        revision: 2 as Revision,
        candidateParts: exists
          ? root.candidateParts.map((current) =>
              current.id === candidate.id ? candidate : current,
            )
          : [...root.candidateParts, candidate],
      };
      return { ok: true, value: undefined };
    },
  };
  return { data, sourceData, commands, root: () => root };
};

test("初期source付き候補作成はkindを補完しprimary代表値を公開する", async () => {
  const h = harness();
  const createdId = "20000000-0000-4000-8000-000000000010" as CandidatePartId;
  const initialSourceId =
    "30000000-0000-4000-8000-000000000010" as CandidateSourceId;
  const project = h.root().projects[0];
  assert.ok(project);
  const service = createCandidateManagementService({
    data: h.data,
    sourceData: h.sourceData,
    classifier: { classify: () => "manufacturer" },
    createCandidateId: () => createdId,
    now: () => "2026-07-28T01:00:00.000Z" as UtcTimestamp,
  });
  const created = await service.createCandidate(
    {
      projectId: project.id,
      category: "uncategorized",
      product: {
        name: { original: "架空CPU", confirmed: "SYN CPU" },
      },
      normalizedAttributes: { category: "uncategorized" },
      sources: [
        {
          id: initialSourceId,
          pageUrl: "https://maker.invalid/synthetic-cpu",
          capturedAt: "2026-07-28T00:00:00.000Z" as UtcTimestamp,
          price: {
            original: "JPY 32100",
            confirmed: { amount: 32100, currency: "JPY" },
          },
        },
      ],
      primarySourceId: initialSourceId,
    },
    context,
  );
  assert.equal(created.ok, true);
  assert.equal(h.commands.length, 1);
  const stored = h
    .root()
    .candidateParts.find((candidate) => candidate.id === createdId);
  assert.equal(stored?.sources[0]?.kind, "manufacturer");
  assert.equal("price" in (stored?.product ?? {}), false);
  const listed = await service.listCandidates({ projectId: project.id });
  assert.equal(listed.ok, true);
  if (!listed.ok) return;
  const summary = listed.value.find((candidate) => candidate.id === createdId);
  assert.equal(summary?.primarySource?.pageUrl, stored?.sources[0]?.pageUrl);
  assert.deepEqual(summary?.price, stored?.sources[0]?.price);
});

test("初期source付き候補の保存失敗は部分的な候補を残さない", async () => {
  const h = harness("storage-unavailable");
  const before = structuredClone(h.root().candidateParts);
  const project = h.root().projects[0];
  assert.ok(project);
  const service = createCandidateManagementService({
    data: h.data,
    sourceData: h.sourceData,
    createCandidateId: () =>
      "20000000-0000-4000-8000-000000000010" as CandidatePartId,
  });
  const result = await service.createCandidate(
    {
      projectId: project.id,
      category: "uncategorized",
      product: { name: { original: "架空CPU", confirmed: "SYN CPU" } },
      normalizedAttributes: { category: "uncategorized" },
      sources: [
        {
          id: "30000000-0000-4000-8000-000000000010" as CandidateSourceId,
          pageUrl: "https://shop.invalid/synthetic-cpu",
        },
      ],
      primarySourceId:
        "30000000-0000-4000-8000-000000000010" as CandidateSourceId,
    },
    context,
  );
  assert.deepEqual(result, { ok: false, error: { kind: "storage" } });
  assert.deepEqual(h.root().candidateParts, before);
});

test("source追加はkindを補完し候補全体を一回だけ更新する", async () => {
  const h = harness();
  const service = createCandidateManagementService({
    data: h.data,
    sourceData: h.sourceData,
    classifier: { classify: () => "manufacturer" },
    now: () => "2026-07-28T01:00:00.000Z" as UtcTimestamp,
  });
  const result = await service.addSource(
    {
      candidateId,
      source: {
        id: "30000000-0000-4000-8000-000000000010" as CandidateSourceId,
        pageUrl: "https://maker.invalid/product/1",
      },
    },
    context,
  );
  assert.equal(result.ok, true);
  assert.equal(h.commands.length, 1);
  assert.equal(h.root().candidateParts[0]?.sources[1]?.kind, "manufacturer");
});

test("明示kindを上書きせずprimary価格だけをsummaryへ投影する", async () => {
  const h = harness();
  const service = createCandidateManagementService({
    data: h.data,
    sourceData: h.sourceData,
    classifier: { classify: () => "manufacturer" },
  });
  await service.addSource(
    {
      candidateId,
      source: {
        id: "30000000-0000-4000-8000-000000000010" as CandidateSourceId,
        pageUrl: "https://shop.invalid/item/2",
        kind: "retail",
        price: {
          original: "JPY 123",
          confirmed: { amount: 123, currency: "JPY" },
        },
      },
    },
    context,
  );
  const project = h.root().projects[0];
  assert.ok(project);
  const listed = await service.listCandidates({
    projectId: project.id,
  });
  assert.equal(h.root().candidateParts[0]?.sources[1]?.kind, "retail");
  assert.equal(listed.ok && listed.value[0]?.price, undefined);
});

for (const [code, expected] of [
  ["revision-conflict", "conflict"],
  ["maintenance-active", "maintenance"],
  ["quota-exceeded", "quota"],
  ["storage-unavailable", "storage"],
] as const) {
  test(`${code}では保存済みsourceを変更しない`, async () => {
    const h = harness(code);
    const before = structuredClone(h.root().candidateParts[0]);
    const service = createCandidateManagementService({
      data: h.data,
      sourceData: h.sourceData,
    });
    const result = await service.setPrimarySource(
      {
        candidateId,
        sourceId: "30000000-0000-4000-8000-000000000001" as CandidateSourceId,
      },
      context,
    );
    assert.equal(result.ok ? "ok" : result.error.kind, expected);
    assert.deepEqual(h.root().candidateParts[0], before);
  });
}

test("危険schemeはmutation前に拒否する", async () => {
  const h = harness();
  const service = createCandidateManagementService({
    data: h.data,
    sourceData: h.sourceData,
  });
  const result = await service.addSource(
    {
      candidateId,
      source: {
        id: "30000000-0000-4000-8000-000000000010" as CandidateSourceId,
        pageUrl: "data:text/plain,blocked",
      },
    },
    context,
  );
  assert.equal(result.ok, false);
  assert.equal(h.commands.length, 0);
});

test("update・primary変更・removeは対象sourceだけを一回の更新で変更する", async () => {
  const h = harness();
  const service = createCandidateManagementService({
    data: h.data,
    sourceData: h.sourceData,
  });
  const secondId = "30000000-0000-4000-8000-000000000010" as CandidateSourceId;
  await service.addSource(
    {
      candidateId,
      source: {
        id: secondId,
        pageUrl: "https://catalog.example.invalid/synthetic-part-2",
      },
    },
    context,
  );
  const firstBefore = structuredClone(h.root().candidateParts[0]?.sources[0]);
  await service.updateSource(
    {
      candidateId,
      source: {
        id: secondId,
        pageUrl: "https://catalog.example.invalid/synthetic-part-2-updated",
        kind: "manufacturer",
      },
    },
    context,
  );
  assert.deepEqual(h.root().candidateParts[0]?.sources[0], firstBefore);
  assert.equal(
    h.root().candidateParts[0]?.sources[1]?.pageUrl,
    "https://catalog.example.invalid/synthetic-part-2-updated",
  );
  await service.setPrimarySource({ candidateId, sourceId: secondId }, context);
  assert.equal(h.root().candidateParts[0]?.primarySourceId, secondId);
  await service.removeSource(
    {
      candidateId,
      sourceId: secondId,
      replacementPrimarySourceId:
        "30000000-0000-4000-8000-000000000001" as CandidateSourceId,
    },
    context,
  );
  assert.equal(h.root().candidateParts[0]?.sources.length, 1);
  assert.equal(h.commands.length, 4);
});

test("schema 2 validation失敗はmutationせず旧候補を維持する", async () => {
  const h = harness();
  const service = createCandidateManagementService({
    data: h.data,
    sourceData: h.sourceData,
  });
  const before = structuredClone(h.root().candidateParts[0]);
  const result = await service.updateSource(
    {
      candidateId,
      source: {
        id: "30000000-0000-4000-8000-000000000001" as CandidateSourceId,
        pageUrl: "data:text/plain,blocked",
      },
    },
    context,
  );
  assert.equal(result.ok ? "ok" : result.error.kind, "validation");
  assert.equal(h.commands.length, 0);
  assert.deepEqual(h.root().candidateParts[0], before);
});

test("手動editorで追加したsourceは保存時に自動分類し明示上書きを優先する", async () => {
  const h = harness();
  const candidate = h.root().candidateParts[0];
  assert.ok(candidate);
  assert.ok(candidate.product.name);
  const manufacturerId =
    "30000000-0000-4000-8000-000000000091" as CandidateSourceId;
  const retailId = "30000000-0000-4000-8000-000000000092" as CandidateSourceId;
  const overrideId =
    "30000000-0000-4000-8000-000000000093" as CandidateSourceId;
  const service = createCandidateManagementService({
    data: h.data,
    sourceData: h.sourceData,
    classifier: {
      classify: (pageUrl) =>
        pageUrl.includes("manufacturer") ? "manufacturer" : "retail",
    },
  });
  const result = await service.updateCandidate(
    {
      id: candidate.id,
      draft: {
        projectId: candidate.projectId,
        category: candidate.category,
        product: { ...candidate.product, name: candidate.product.name },
        normalizedAttributes: candidate.normalizedAttributes,
        sources: [
          ...candidate.sources,
          {
            id: manufacturerId,
            pageUrl: "https://manufacturer.example.invalid/item",
          },
          {
            id: retailId,
            pageUrl: "https://shop.example.invalid/item",
          },
          {
            id: overrideId,
            pageUrl: "https://manufacturer.example.invalid/overridden",
            kind: "retail",
          },
        ],
        primarySourceId: candidate.primarySourceId,
      } as CandidateDraft,
    },
    context,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(
    result.value.sources.find(({ id }) => id === manufacturerId)?.kind,
    "manufacturer",
  );
  assert.equal(
    result.value.sources.find(({ id }) => id === retailId)?.kind,
    "retail",
  );
  assert.equal(
    result.value.sources.find(({ id }) => id === overrideId)?.kind,
    "retail",
  );
});
