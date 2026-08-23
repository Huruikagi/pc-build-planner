import assert from "node:assert/strict";
import test from "node:test";
import type {
  CandidatePartId,
  CandidateSourceId,
  CandidateSourceMatcherPort,
  CandidateSourceMutationPort,
  PatchCandidateSourcePriceInput,
  SourceMatchResult,
} from "../../src/candidate-sources/public.js";
import { routeDuplicateSource } from "./duplicate-product-candidate-sources-consumer.js";

const candidateId = "81000000-0000-4000-8000-000000000001" as CandidatePartId;
const sourceId = "81000000-0000-4000-8000-000000000002" as CandidateSourceId;
const pageUrl = "https://duplicate-route.example.invalid/synthetic-part";

const run = async (match: SourceMatchResult) => {
  const calls: string[] = [];
  const matcher: CandidateSourceMatcherPort = {
    async matchByPageUrl() {
      return { ok: true, value: match };
    },
  };
  const mutations = {
    async addSource() {
      calls.push("add");
      return { ok: true, value: {} };
    },
    async patchSourcePrice() {
      calls.push("patch");
      return { ok: true, value: {} };
    },
    async updateSource() {
      throw new Error("unexpected update");
    },
    async removeSource() {
      throw new Error("unexpected remove");
    },
    async setPrimarySource() {
      throw new Error("unexpected primary");
    },
  } as unknown as CandidateSourceMutationPort;
  const result = await routeDuplicateSource(
    { matcher, mutations },
    candidateId,
    { id: sourceId, pageUrl },
    {
      expectedPageUrl: pageUrl,
      expectedKind: "retail",
      price: {
        original: "synthetic 100",
        confirmed: { amount: 100, currency: "JPY" },
      },
      capturedAt:
        "2026-08-24T00:00:00.000Z" as PatchCandidateSourcePriceInput["capturedAt"],
    },
  );
  return { calls, result };
};

test("duplicate routeはno-matchでaddだけを呼ぶ", async () => {
  assert.deepEqual(await run({ kind: "no-match" }), {
    calls: ["add"],
    result: { kind: "added" },
  });
});

test("duplicate routeはuniqueでconditional patchだけを呼ぶ", async () => {
  const reference = {
    candidateId,
    sourceId,
    pageUrl,
    kind: "retail" as const,
    isPrimary: true,
  };
  assert.deepEqual(await run({ kind: "unique", reference }), {
    calls: ["patch"],
    result: { kind: "mutated", reference },
  });
});

test("duplicate routeはambiguousでmutationしない", async () => {
  const references = [
    { candidateId, sourceId, pageUrl, isPrimary: true },
    {
      candidateId,
      sourceId: "81000000-0000-4000-8000-000000000003" as CandidateSourceId,
      pageUrl,
      isPrimary: false,
    },
  ];
  assert.deepEqual(await run({ kind: "ambiguous-match", references }), {
    calls: [],
    result: { kind: "ambiguous-no-op", references },
  });
});
