import assert from "node:assert/strict";
import test from "node:test";

import type { UtcTimestamp } from "../../src/domain/identifiers.js";
import type {
  CandidatePart,
  CandidatePartId,
  CandidateSource,
  CandidateSourceId,
  LocalDataRoot,
  ProjectId,
} from "../../src/domain/model.js";

const projectId = "11111111-1111-4111-8111-111111111111" as ProjectId;
const candidateId = "22222222-2222-4222-8222-222222222222" as CandidatePartId;
const sourceId = "33333333-3333-4333-8333-333333333333" as CandidateSourceId;
const capturedAt = "2026-07-28T01:02:03.000Z" as UtcTimestamp;

const source = {
  id: sourceId,
  pageUrl: "https://shop.example.invalid/products/cpu",
  siteName: "架空ショップ",
  capturedAt,
  price: {
    original: "12,345 JPY",
    confirmed: { amount: 12345, currency: "JPY" },
  },
  kind: "retail",
} satisfies CandidateSource;

const baseCandidate = {
  id: candidateId,
  projectId,
  category: "cpu",
  product: { name: { original: "架空CPU" } },
  normalizedAttributes: { category: "cpu" },
  createdAt: capturedAt,
  updatedAt: capturedAt,
} as const;

const manualCandidate = {
  ...baseCandidate,
  sources: [],
} satisfies CandidatePart;

const sourcedCandidate = {
  ...baseCandidate,
  sources: [source],
  primarySourceId: sourceId,
} satisfies CandidatePart;

const canonicalRoot = {
  schemaVersion: 1,
  revision: 0,
  projects: [],
  candidateParts: [manualCandidate, sourcedCandidate],
  currentBuilds: [],
  requestDedupe: [],
  maintenance: { generation: 0, active: false },
} as unknown as LocalDataRoot;

test("canonical schema 1契約はsourceなしと取得元別価格を型安全に表現する", () => {
  assert.equal(canonicalRoot.schemaVersion, 1);
  assert.deepEqual(manualCandidate.sources, []);
  assert.equal(sourcedCandidate.sources[0]?.price?.confirmed?.amount, 12345);
  assert.equal("price" in sourcedCandidate.product, false);
  assert.equal("sourceInfo" in sourcedCandidate, false);
});

const legacyPrice: CandidatePart = {
  ...baseCandidate,
  product: {
    ...baseCandidate.product,
    // @ts-expect-error canonical商品の共通値へpriceは保存できない。
    price: { original: "100 JPY" },
  },
  sources: [],
};
void legacyPrice;

const legacySourceInfo: CandidatePart = {
  ...baseCandidate,
  sources: [],
  // @ts-expect-error canonical候補へ単数sourceInfoは保存できない。
  sourceInfo: {},
};
void legacySourceInfo;

// @ts-expect-error sourceが非空ならprimarySourceIdが必須。
const missingPrimarySource: CandidatePart = {
  ...baseCandidate,
  sources: [source],
};
void missingPrimarySource;

// @ts-expect-error sourceが空ならprimarySourceIdを持てない。
const unexpectedPrimarySource: CandidatePart = {
  ...baseCandidate,
  sources: [],
  primarySourceId: sourceId,
};
void unexpectedPrimarySource;
