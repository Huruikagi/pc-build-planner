import assert from "node:assert/strict";
import test from "node:test";

import { createUtcTimestamp } from "../../src/domain/identifiers.js";
import type {
  CandidatePart,
  CandidateSource,
  CandidateSourceId,
} from "../../src/domain/model.js";
import type { SourceSnapshot } from "../../src/domain/normalized-attributes.js";

type CandidateSourceMetadata = Pick<
  CandidatePart,
  "sources" | "primarySourceId" | "sourceSnapshot"
>;

const sourceId = "33333333-3333-4333-8333-333333333333" as CandidateSourceId;
const manualCandidate = { sources: [] } satisfies CandidateSourceMetadata;
const urlOnlySource = {
  id: sourceId,
  pageUrl: "https://example.invalid/products/synthetic",
} satisfies CandidateSource;
const capturedAtOnlySource = {
  id: sourceId,
  capturedAt: createUtcTimestamp(new Date("2026-07-22T00:00:00.000Z")),
} satisfies CandidateSource;

const sourceSnapshot = {
  name: "架空 CPU",
  manufacturer: null,
} satisfies SourceSnapshot;

const candidateWithSnapshot = {
  sources: [],
  sourceSnapshot,
} satisfies CandidateSourceMetadata;

function assertSnapshotIsReadonly(snapshot: SourceSnapshot): void {
  // @ts-expect-error 元表記snapshotはconsumerから変更できない公開契約である。
  snapshot.name = "変更後";
}

void assertSnapshotIsReadonly;

test("sourceなしとURL・取得日時の部分欠損を区別できる", () => {
  assert.deepEqual(manualCandidate.sources, []);
  assert.equal(urlOnlySource.pageUrl.includes("example.invalid"), true);
  assert.equal("capturedAt" in urlOnlySource, false);
  assert.equal(capturedAtOnlySource.capturedAt.endsWith("Z"), true);
  assert.equal("pageUrl" in capturedAtOnlySource, false);
});

test("snapshotのkey不在と明示的なnullを区別できる", () => {
  assert.equal(candidateWithSnapshot.sourceSnapshot.name, "架空 CPU");
  assert.equal(candidateWithSnapshot.sourceSnapshot.manufacturer, null);
  assert.equal("modelNumber" in candidateWithSnapshot.sourceSnapshot, false);
});
