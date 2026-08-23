import assert from "node:assert/strict";
import test from "node:test";
import {
  type CandidateSourceReference,
  type CandidateSourceScope,
  createCandidateSourceMatcher,
} from "../../src/candidate-sources/public.js";
import { ok } from "../../src/domain/public.js";

const candidateA = "candidate-a" as CandidateSourceReference["candidateId"];
const candidateB = "candidate-b" as CandidateSourceReference["candidateId"];

const reference = (
  candidateId: CandidateSourceReference["candidateId"],
  sourceId: string,
  pageUrl: string | undefined,
  overrides: Partial<CandidateSourceReference> = {},
): CandidateSourceReference => ({
  candidateId,
  sourceId: sourceId as CandidateSourceReference["sourceId"],
  ...(pageUrl === undefined ? {} : { pageUrl }),
  kind: "retail",
  isPrimary: false,
  ...overrides,
});

const createSubject = (references: readonly CandidateSourceReference[]) => {
  const scopes: CandidateSourceScope[] = [];
  const matcher = createCandidateSourceMatcher({
    listSourceReferences: async ({ scope }) => {
      scopes.push(scope);
      return ok(
        scope.kind === "all-candidates"
          ? references
          : references.filter((item) => item.candidateId === scope.candidateId),
      );
    },
  });
  return { matcher, scopes };
};

test("all-candidates と candidate scope を snapshot reader へそのまま渡す", async () => {
  const outside = reference(
    candidateB,
    "outside",
    "https://shop.example.invalid/item#outside",
  );
  const inside = reference(
    candidateA,
    "inside",
    "HTTPS://SHOP.EXAMPLE.INVALID:443/item#inside",
  );
  const { matcher, scopes } = createSubject([outside, inside]);

  assert.deepEqual(
    await matcher.matchByPageUrl({
      scope: { kind: "candidate", candidateId: candidateA },
      pageUrl: "https://shop.example.invalid/item",
    }),
    { ok: true, value: { kind: "unique", reference: inside } },
  );
  assert.deepEqual(
    await matcher.matchByPageUrl({
      scope: { kind: "all-candidates" },
      pageUrl: "https://shop.example.invalid/item",
    }),
    {
      ok: true,
      value: { kind: "ambiguous-match", references: [outside, inside] },
    },
  );
  assert.deepEqual(scopes, [
    { kind: "candidate", candidateId: candidateA },
    { kind: "all-candidates" },
  ]);
});

test("0件と1件を no-match / unique として返す", async () => {
  const only = reference(
    candidateA,
    "only",
    "https://shop.example.invalid/item?sku=1",
  );
  const { matcher } = createSubject([only]);

  assert.deepEqual(
    await matcher.matchByPageUrl({
      scope: { kind: "all-candidates" },
      pageUrl: "https://shop.example.invalid/item?sku=2",
    }),
    { ok: true, value: { kind: "no-match" } },
  );
  assert.deepEqual(
    await matcher.matchByPageUrl({
      scope: { kind: "all-candidates" },
      pageUrl: "https://shop.example.invalid/item?sku=1#ignored",
    }),
    { ok: true, value: { kind: "unique", reference: only } },
  );
});

test("複数一致は primary・kind・price相当の情報や保存順で選ばず全referenceを返す", async () => {
  const secondaryRetail = reference(
    candidateA,
    "secondary-retail",
    "https://shop.example.invalid/item#one",
  );
  const primaryManufacturer = reference(
    candidateB,
    "primary-manufacturer",
    "https://shop.example.invalid/item#two",
    { kind: "manufacturer", isPrimary: true },
  );

  for (const references of [
    [secondaryRetail, primaryManufacturer],
    [primaryManufacturer, secondaryRetail],
  ]) {
    const { matcher } = createSubject(references);
    const result = await matcher.matchByPageUrl({
      scope: { kind: "all-candidates" },
      pageUrl: "https://shop.example.invalid/item",
    });
    assert.equal(result.ok, true);
    if (!result.ok || result.value.kind !== "ambiguous-match") continue;
    assert.deepEqual(result.value.references, references);
  }
});

test("invalidな保存URLを誤一致させず、有効な重複だけを保持する", async () => {
  const invalid = reference(candidateA, "invalid", "javascript:alert(1)");
  const missing = reference(candidateA, "missing", undefined);
  const first = reference(
    candidateA,
    "first",
    "https://shop.example.invalid/item#first",
  );
  const second = reference(
    candidateA,
    "second",
    "https://shop.example.invalid/item#second",
  );
  const { matcher } = createSubject([invalid, first, missing, second]);

  assert.deepEqual(
    await matcher.matchByPageUrl({
      scope: { kind: "candidate", candidateId: candidateA },
      pageUrl: "https://shop.example.invalid/item",
    }),
    {
      ok: true,
      value: { kind: "ambiguous-match", references: [first, second] },
    },
  );
});

test("照合入力URLが不正ならsource validation failureを返す", async () => {
  const { matcher } = createSubject([]);
  assert.deepEqual(
    await matcher.matchByPageUrl({
      scope: { kind: "all-candidates" },
      pageUrl: "file:///item",
    }),
    {
      ok: false,
      error: { kind: "source-identity-failure", reason: "unsafe-scheme" },
    },
  );
});
