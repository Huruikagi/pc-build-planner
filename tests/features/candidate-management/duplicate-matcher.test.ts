import assert from "node:assert/strict";
import test from "node:test";

import type {
  CandidatePartId,
  ProjectId,
  UtcTimestamp,
  Uuid,
} from "../../../src/domain/public.js";
import type {
  CandidateDraft,
  CandidateSummary,
} from "../../../src/features/candidate-management/contracts.js";
import { createDuplicateCandidateMatcher } from "../../../src/features/candidate-management/duplicate-matcher.js";
import { createProductIdentityNormalizer } from "../../../src/features/product-capture/public.js";

const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const timestamp = "2026-07-28T00:00:00.000Z" as UtcTimestamp;
const id = (suffix: string) =>
  `30000000-0000-4000-8000-${suffix}` as Uuid as CandidatePartId;

const draft = (overrides: Partial<CandidateDraft> = {}): CandidateDraft =>
  ({
    projectId,
    category: "cpu",
    product: {
      name: { original: "架空 Processor", confirmed: "Synthetic Processor" },
      manufacturer: { original: "架空社", confirmed: "Example Labs" },
      modelNumber: { original: "EX-100", confirmed: "EX-100" },
    },
    normalizedAttributes: { category: "cpu" },
    ...overrides,
  }) as CandidateDraft;

const candidate = (
  candidateId: CandidatePartId,
  overrides: Partial<CandidateSummary> = {},
): CandidateSummary =>
  ({
    id: candidateId,
    projectId,
    category: "cpu",
    name: { original: "Synthetic Processor" },
    manufacturer: { original: "Example Labs" },
    modelNumber: { original: "EX100" },
    hasMissingDetails: false,
    updatedAt: timestamp,
    ...overrides,
  }) as CandidateSummary;

const candidateWithout = (
  candidateId: CandidatePartId,
  omitted: readonly (keyof CandidateSummary)[],
  overrides: Partial<CandidateSummary> = {},
): CandidateSummary => {
  const summary = { ...candidate(candidateId, overrides) } as Record<
    keyof CandidateSummary,
    unknown
  >;
  for (const key of omitted) delete summary[key];
  return summary as unknown as CandidateSummary;
};

test("model match is high, explanatory, category-gated and deterministically sorted", () => {
  const matcher = createDuplicateCandidateMatcher(
    createProductIdentityNormalizer(),
  );
  const highB = candidate(id("000000000002"));
  const highA = candidate(id("000000000001"), { category: "uncategorized" });
  const wrongCategory = candidate(id("000000000000"), { category: "gpu" });

  const matches = matcher.match(draft(), [highB, wrongCategory, highA]);

  assert.deepEqual(
    matches.map(({ candidateId }) => candidateId),
    [highA.id, highB.id],
  );
  assert.equal(matches[0]?.confidence, "high");
  assert.deepEqual(matches[0]?.evidence, { kind: "model-number" });
  assert.equal(matches[0]?.summary, highA);
});

test("manufacturer and name are supporting only when model mismatch does not disqualify", () => {
  const matcher = createDuplicateCandidateMatcher(
    createProductIdentityNormalizer(),
  );
  const supporting = candidateWithout(id("000000000004"), ["modelNumber"]);
  const mismatchedModel = candidate(id("000000000003"), {
    modelNumber: { original: "EX-200" },
  });

  const matches = matcher.match(draft(), [mismatchedModel, supporting]);

  assert.deepEqual(
    matches.map(({ candidateId }) => candidateId),
    [supporting.id],
  );
  assert.equal(matches[0]?.confidence, "supporting");
  assert.deepEqual(matches[0]?.evidence, { kind: "manufacturer-name" });
});

test("high matches precede supporting matches before candidate ID ordering", () => {
  const matcher = createDuplicateCandidateMatcher(
    createProductIdentityNormalizer(),
  );
  const supportingA = candidateWithout(id("000000000001"), ["modelNumber"]);
  const supportingB = candidateWithout(id("000000000004"), ["modelNumber"]);
  const highA = candidate(id("000000000002"));
  const highB = candidate(id("000000000003"));

  const matches = matcher.match(draft(), [
    supportingB,
    highB,
    supportingA,
    highA,
  ]);

  assert.deepEqual(
    matches.map(({ candidateId }) => candidateId),
    [highA.id, highB.id, supportingA.id, supportingB.id],
  );
});

test("missing and partial identity never create a match", () => {
  const matcher = createDuplicateCandidateMatcher(
    createProductIdentityNormalizer(),
  );
  const missingManufacturer = candidateWithout(id("000000000005"), [
    "manufacturer",
    "modelNumber",
  ]);
  const empty = candidateWithout(
    id("000000000006"),
    ["manufacturer", "modelNumber"],
    { name: { original: "   " } },
  );

  assert.deepEqual(
    matcher.match(
      draft({ product: { name: { original: "Synthetic Processor" } } }),
      [missingManufacturer, empty],
    ),
    [],
  );
});
