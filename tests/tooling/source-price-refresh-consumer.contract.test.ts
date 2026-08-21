import assert from "node:assert/strict";
import test from "node:test";
import type {
  CandidatePartId,
  CandidateSourceId,
} from "../../src/domain/public.js";
import type {
  CandidateSourceCatalogPort,
  CandidateSourceReference,
} from "../../src/features/candidate-management/public.js";
import {
  findRefreshTargets,
  listRefreshTargets,
  resolveRefreshTarget,
} from "./source-price-refresh-consumer.js";

const firstCandidateId =
  "20000000-0000-4000-8000-000000000001" as CandidatePartId;
const secondCandidateId =
  "20000000-0000-4000-8000-000000000002" as CandidatePartId;
const firstSourceId =
  "30000000-0000-4000-8000-000000000001" as CandidateSourceId;
const secondSourceId =
  "30000000-0000-4000-8000-000000000002" as CandidateSourceId;

const references: readonly CandidateSourceReference[] = [
  {
    candidateId: firstCandidateId,
    sourceId: firstSourceId,
    pageUrl: "https://prices.example.invalid/products/synthetic-part",
    kind: "retail",
    isPrimary: true,
  },
  {
    candidateId: secondCandidateId,
    sourceId: secondSourceId,
    pageUrl: "https://prices.example.invalid/products/synthetic-part",
    kind: "retail",
    isPrimary: true,
  },
];

const catalog = (): CandidateSourceCatalogPort => ({
  async listSourceReferences(input) {
    return {
      ok: true,
      value:
        input.candidateId === undefined
          ? references
          : references.filter(
              (reference) => reference.candidateId === input.candidateId,
            ),
    };
  },
  async getSourceReference(input) {
    const value = references.find(
      (reference) =>
        reference.candidateId === input.candidateId &&
        reference.sourceId === input.sourceId,
    );
    return value === undefined
      ? {
          ok: false,
          error: {
            code: "validation",
            reason: "entity-not-found",
            message: "source",
          },
        }
      : { ok: true, value };
  },
});

test("価格更新consumerは公開catalogから全件または候補限定で参照を取得する", async () => {
  assert.deepEqual(await listRefreshTargets(catalog()), {
    kind: "ready",
    references,
  });
  assert.deepEqual(await listRefreshTargets(catalog(), firstCandidateId), {
    kind: "ready",
    references: [references[0]],
  });
});

test("URL同一性と0件・1件・複数件の曖昧さはconsumerが判定する", async () => {
  const sourceCatalog = catalog();
  assert.deepEqual(
    await findRefreshTargets(
      sourceCatalog,
      "https://prices.example.invalid/products/missing",
    ),
    { kind: "none" },
  );
  assert.deepEqual(
    await findRefreshTargets(
      sourceCatalog,
      "https://prices.example.invalid/products/synthetic-part",
      firstCandidateId,
    ),
    { kind: "single", reference: references[0] },
  );
  assert.deepEqual(
    await findRefreshTargets(
      sourceCatalog,
      "https://prices.example.invalid/products/synthetic-part",
    ),
    { kind: "ambiguous", references },
  );
  assert.deepEqual(
    await findRefreshTargets(
      sourceCatalog,
      "https://PRICES.example.invalid/products/synthetic-part",
    ),
    { kind: "none" },
  );
});

test("再取得時のsource not-foundをstale targetへ変換する", async () => {
  assert.deepEqual(
    await resolveRefreshTarget(catalog(), {
      candidateId: firstCandidateId,
      sourceId: secondSourceId,
    }),
    { kind: "stale-target" },
  );
  assert.deepEqual(
    await resolveRefreshTarget(catalog(), {
      candidateId: firstCandidateId,
      sourceId: firstSourceId,
    }),
    { kind: "ready", reference: references[0] },
  );
});
