import assert from "node:assert/strict";
import test from "node:test";
import {
  type CandidateSourceCatalogSnapshotPort,
  createCandidateSourceCatalog,
} from "../../src/candidate-sources/public.js";
import type {
  AppDataError,
  CandidatePart,
  CandidatePartId,
  CandidateSourceId,
  LocalDataRoot,
  Result,
} from "../../src/domain/public.js";
import { sourceRoot } from "../fixtures/candidate-source-root.js";

const candidateId = "20000000-0000-4000-8000-000000000001" as CandidatePartId;
const secondCandidateId =
  "20000000-0000-4000-8000-000000000002" as CandidatePartId;
const sourceId = "30000000-0000-4000-8000-000000000001" as CandidateSourceId;

const snapshots = (
  result: Result<LocalDataRoot, AppDataError>,
): CandidateSourceCatalogSnapshotPort & { readonly reads: () => number } => {
  let reads = 0;
  return {
    reads: () => reads,
    async query(project) {
      reads += 1;
      return result.ok ? { ok: true, value: project(result.value) } : result;
    },
  };
};

test("catalogは一回のsnapshotから全件・candidate限定を最小referenceで列挙する", async () => {
  const data = snapshots({ ok: true, value: sourceRoot() });
  const catalog = createCandidateSourceCatalog({ data });

  const all = await catalog.listSourceReferences({
    scope: { kind: "all-candidates" },
  });
  assert.equal(data.reads(), 1);
  assert.deepEqual(all, {
    ok: true,
    value: [
      {
        candidateId,
        sourceId,
        pageUrl: "https://catalog.example.invalid/synthetic-part-1",
        kind: "retail",
        isPrimary: true,
      },
      {
        candidateId: secondCandidateId,
        sourceId: "30000000-0000-4000-8000-000000000002",
        pageUrl: "https://catalog.example.invalid/synthetic-part-1",
        kind: "manufacturer",
        isPrimary: true,
      },
    ],
  });

  const scoped = await catalog.listSourceReferences({
    scope: { kind: "candidate", candidateId },
  });
  assert.equal(data.reads(), 2);
  assert.deepEqual(scoped.ok && scoped.value, all.ok && [all.value[0]]);
  if (scoped.ok) {
    assert.deepEqual(Object.keys(scoped.value[0] ?? {}).sort(), [
      "candidateId",
      "isPrimary",
      "kind",
      "pageUrl",
      "sourceId",
    ]);
  }
});

test("catalogはsourceなし、entity別not-found、ID再取得を区別する", async () => {
  const root = sourceRoot();
  const catalog = createCandidateSourceCatalog({
    data: snapshots({ ok: true, value: root }),
  });
  const emptyId = root.candidateParts[2]?.id as CandidatePartId;
  const missingCandidate =
    "20000000-0000-4000-8000-000000000099" as CandidatePartId;
  const missingSource =
    "30000000-0000-4000-8000-000000000099" as CandidateSourceId;

  assert.deepEqual(
    await catalog.listSourceReferences({
      scope: { kind: "candidate", candidateId: emptyId },
    }),
    { ok: true, value: [] },
  );
  assert.deepEqual(
    await catalog.listSourceReferences({
      scope: { kind: "candidate", candidateId: missingCandidate },
    }),
    { ok: false, error: { kind: "not-found", entity: "candidate" } },
  );
  assert.deepEqual(
    await catalog.getSourceReference({ candidateId, sourceId }),
    {
      ok: true,
      value: {
        candidateId,
        sourceId,
        pageUrl: "https://catalog.example.invalid/synthetic-part-1",
        kind: "retail",
        isPrimary: true,
      },
    },
  );
  assert.deepEqual(
    await catalog.getSourceReference({
      candidateId: missingCandidate,
      sourceId,
    }),
    { ok: false, error: { kind: "not-found", entity: "candidate" } },
  );
  assert.deepEqual(
    await catalog.getSourceReference({ candidateId, sourceId: missingSource }),
    { ok: false, error: { kind: "not-found", entity: "source" } },
  );
});

test("catalogは重複を保持しdata failureを公開projectionへ通す", async () => {
  const root = sourceRoot();
  const duplicate = root.candidateParts[0]?.sources[0];
  const candidate = root.candidateParts[0];
  assert.ok(candidate && duplicate);
  const duplicatedRoot: LocalDataRoot = {
    ...root,
    candidateParts: [
      { ...candidate, sources: [duplicate, duplicate] } as CandidatePart,
      ...root.candidateParts.slice(1),
    ],
  };
  const catalog = createCandidateSourceCatalog({
    data: snapshots({ ok: true, value: duplicatedRoot }),
  });
  const listed = await catalog.listSourceReferences({
    scope: { kind: "candidate", candidateId },
  });
  assert.equal(listed.ok && listed.value.length, 2);

  const error = { code: "storage-unavailable" } as const satisfies AppDataError;
  const failed = createCandidateSourceCatalog({
    data: snapshots({ ok: false, error }),
  });
  assert.deepEqual(
    await failed.listSourceReferences({ scope: { kind: "all-candidates" } }),
    { ok: false, error: { kind: "data", error } },
  );
});
