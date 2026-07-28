import assert from "node:assert/strict";
import test from "node:test";
import type {
  CandidatePartId,
  CandidateSourceId,
  LocalDataRootV2,
} from "../../../src/domain/public.js";
import { createCandidateSourceCatalog } from "../../../src/features/candidate-management/source-catalog.js";
import type { CandidateSourceDataPort } from "../../../src/features/candidate-management/source-data-port.js";
import { sourceRootV2 } from "../../fixtures/candidate-source-root-v2.js";

const candidateId = "20000000-0000-4000-8000-000000000001" as CandidatePartId;
const secondCandidateId =
  "20000000-0000-4000-8000-000000000002" as CandidatePartId;
const sourceId = "30000000-0000-4000-8000-000000000001" as CandidateSourceId;

const data = (root: LocalDataRootV2): CandidateSourceDataPort =>
  ({
    async query(project) {
      return { ok: true, value: project(root) };
    },
  }) as CandidateSourceDataPort;

test("catalogは保存順と同一URLの重複を維持してsource参照を投影する", async () => {
  const catalog = createCandidateSourceCatalog({ data: data(sourceRootV2()) });
  const all = await catalog.listSourceReferences({});
  assert.equal(all.ok, true);
  if (!all.ok) return;
  assert.deepEqual(
    all.value.map(({ candidateId, sourceId, pageUrl, isPrimary }) => ({
      candidateId,
      sourceId,
      pageUrl,
      isPrimary,
    })),
    [
      {
        candidateId,
        sourceId,
        pageUrl: "https://catalog.example.invalid/synthetic-part-1",
        isPrimary: true,
      },
      {
        candidateId: secondCandidateId,
        sourceId: "30000000-0000-4000-8000-000000000002",
        pageUrl: "https://catalog.example.invalid/synthetic-part-1",
        isPrimary: true,
      },
    ],
  );
});

test("catalogはcandidate/source not-foundとsourceなし空配列を区別する", async () => {
  const root = sourceRootV2();
  const catalog = createCandidateSourceCatalog({ data: data(root) });
  const emptyId = root.candidateParts[2]?.id as CandidatePartId;
  assert.deepEqual(
    await catalog.listSourceReferences({ candidateId: emptyId }),
    {
      ok: true,
      value: [],
    },
  );
  assert.deepEqual(
    await catalog.listSourceReferences({
      candidateId: "20000000-0000-4000-8000-000000000099" as CandidatePartId,
    }),
    { ok: false, error: { kind: "not-found", entity: "candidate" } },
  );
  assert.deepEqual(
    await catalog.getSourceReference({
      candidateId,
      sourceId: "30000000-0000-4000-8000-000000000099" as CandidateSourceId,
    }),
    { ok: false, error: { kind: "not-found", entity: "source" } },
  );
});

test("catalogは指定候補だけを列挙しcandidate/source IDで最小DTOを再取得する", async () => {
  const catalog = createCandidateSourceCatalog({ data: data(sourceRootV2()) });
  const limited = await catalog.listSourceReferences({ candidateId });
  assert.deepEqual(limited, {
    ok: true,
    value: [
      {
        candidateId,
        sourceId,
        pageUrl: "https://catalog.example.invalid/synthetic-part-1",
        kind: "retail",
        isPrimary: true,
      },
    ],
  });
  const fetched = await catalog.getSourceReference({ candidateId, sourceId });
  assert.deepEqual(fetched, {
    ok: true,
    value: {
      candidateId,
      sourceId,
      pageUrl: "https://catalog.example.invalid/synthetic-part-1",
      kind: "retail",
      isPrimary: true,
    },
  });
  if (fetched.ok)
    assert.deepEqual(Object.keys(fetched.value).sort(), [
      "candidateId",
      "isPrimary",
      "kind",
      "pageUrl",
      "sourceId",
    ]);
});
