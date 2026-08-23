import assert from "node:assert/strict";
import test from "node:test";
import type {
  CandidateSourceMatcherPort,
  SourceMatchResult,
  SourcePricePatchContract,
} from "../../src/candidate-sources/public.js";
import type {
  AppDataError,
  CandidatePart,
  CandidatePartId,
  CandidateSourceId,
} from "../../src/domain/public.js";
import {
  classifySourcePriceAppDataError,
  refreshMatchedRetailSource,
} from "./source-price-candidate-sources-consumer.js";

const candidateId = "91000000-0000-4000-8000-000000000001" as CandidatePartId;
const sourceId = "91000000-0000-4000-8000-000000000002" as CandidateSourceId;
const pageUrl = "https://price-consumer.example.invalid/synthetic-part";

test("canonical matchのunique targetだけを条件付きprice patchへ渡す", async () => {
  const calls: unknown[] = [];
  const reference = {
    candidateId,
    sourceId,
    pageUrl,
    kind: "retail" as const,
    isPrimary: true,
  };
  const matcher: CandidateSourceMatcherPort = {
    async matchByPageUrl(input) {
      calls.push({ match: input });
      return { ok: true, value: { kind: "unique", reference } };
    },
  };
  const patches: SourcePricePatchContract = {
    async patchSourcePrice(input) {
      calls.push({ patch: input });
      return { ok: true, value: {} as CandidatePart };
    },
  };

  const result = await refreshMatchedRetailSource(
    matcher,
    patches,
    { kind: "candidate", candidateId },
    {
      pageUrl,
      price: {
        original: "synthetic 12000",
        confirmed: { amount: 12000, currency: "JPY" },
      },
      capturedAt: "2026-08-24T01:00:00.000Z" as never,
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    { match: { scope: { kind: "candidate", candidateId }, pageUrl } },
    {
      patch: {
        candidateId,
        sourceId,
        expectedPageUrl: pageUrl,
        expectedKind: "retail",
        price: {
          original: "synthetic 12000",
          confirmed: { amount: 12000, currency: "JPY" },
        },
        capturedAt: "2026-08-24T01:00:00.000Z",
      },
    },
  ]);
});

test("no-match、ambiguity、ineligibleはpatchせずcanonical結果を保持する", async () => {
  const cases: readonly SourceMatchResult[] = [
    { kind: "no-match" },
    {
      kind: "ambiguous-match",
      references: [
        { candidateId, sourceId, pageUrl, kind: "retail", isPrimary: true },
        {
          candidateId,
          sourceId: "91000000-0000-4000-8000-000000000003" as CandidateSourceId,
          pageUrl,
          kind: "retail",
          isPrimary: false,
        },
      ],
    },
    {
      kind: "unique",
      reference: {
        candidateId,
        sourceId,
        pageUrl,
        kind: "manufacturer",
        isPrimary: true,
      },
    },
  ];
  for (const value of cases) {
    let patches = 0;
    const result = await refreshMatchedRetailSource(
      { matchByPageUrl: async () => ({ ok: true, value }) },
      {
        async patchSourcePrice() {
          patches += 1;
          return { ok: true, value: {} as CandidatePart };
        },
      },
      { kind: "all-candidates" },
      {
        pageUrl,
        price: {
          original: "synthetic 12000",
          confirmed: { amount: 12000, currency: "JPY" },
        },
        capturedAt: "2026-08-24T01:00:00.000Z" as never,
      },
    );
    assert.equal(patches, 0);
    assert.equal(result.ok, true);
  }
});

test("foundation公開AppDataErrorを全codeでexhaustiveに分類する", () => {
  const errors = [
    { code: "validation" },
    { code: "corrupt-data" },
    { code: "unsupported-version" },
    { code: "migration-failed" },
    { code: "repair-failed" },
    { code: "revision-conflict" },
    { code: "request-conflict" },
    { code: "maintenance-active" },
    { code: "recovery-active" },
    { code: "stale-recovery-state" },
    { code: "stale-fence" },
    { code: "stale-assessment" },
    { code: "precommit-cleanup-pending" },
    { code: "quota-exceeded" },
    { code: "access-denied" },
    { code: "lock-unavailable" },
    { code: "storage-unavailable" },
  ] as const satisfies readonly AppDataError[];
  assert.deepEqual(errors.map(classifySourcePriceAppDataError), [
    "validation",
    "unsupported-data",
    "unsupported-data",
    "unsupported-data",
    "unsupported-data",
    "conflict",
    "conflict",
    "maintenance",
    "maintenance",
    "conflict",
    "conflict",
    "conflict",
    "maintenance",
    "quota",
    "storage",
    "storage",
    "storage",
  ]);
});
