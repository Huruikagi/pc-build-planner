import assert from "node:assert/strict";
import test from "node:test";

import { createUtcTimestamp } from "../../src/domain/identifiers.js";
import type { CandidatePart } from "../../src/domain/model.js";
import type {
  SourceInfo,
  SourceSnapshot,
} from "../../src/domain/normalized-attributes.js";

type CandidateSourceMetadata = Pick<
  CandidatePart,
  "sourceInfo" | "sourceSnapshot"
>;

const manualCandidate = {} satisfies CandidateSourceMetadata;

const urlOnlySource = {
  sourceInfo: { pageUrl: "https://example.invalid/products/synthetic" },
} satisfies CandidateSourceMetadata;

const capturedAtOnlySource = {
  sourceInfo: {
    capturedAt: createUtcTimestamp(new Date("2026-07-22T00:00:00.000Z")),
  },
} satisfies CandidateSourceMetadata;

const sourceSnapshot = {
  name: "架空 CPU",
  manufacturer: null,
} satisfies SourceSnapshot;

const candidateWithSnapshot = {
  sourceSnapshot,
} satisfies CandidateSourceMetadata;

function assertSnapshotIsReadonly(snapshot: SourceSnapshot): void {
  // @ts-expect-error 元表記snapshotはconsumerから変更できない公開契約である。
  snapshot.name = "変更後";
}

void assertSnapshotIsReadonly;

test("取得元の完全欠損とURL・取得日時の部分欠損を区別できる", () => {
  assert.equal("sourceInfo" in manualCandidate, false);
  assert.equal(
    urlOnlySource.sourceInfo.pageUrl.includes("example.invalid"),
    true,
  );
  assert.equal("capturedAt" in urlOnlySource.sourceInfo, false);
  assert.equal(capturedAtOnlySource.sourceInfo.capturedAt.endsWith("Z"), true);
  assert.equal("pageUrl" in capturedAtOnlySource.sourceInfo, false);
});

test("snapshotのkey不在と明示的なnullを区別できる", () => {
  assert.equal(candidateWithSnapshot.sourceSnapshot.name, "架空 CPU");
  assert.equal(candidateWithSnapshot.sourceSnapshot.manufacturer, null);
  assert.equal("modelNumber" in candidateWithSnapshot.sourceSnapshot, false);
});

const completeSourceInfo = {
  pageUrl: "https://example.invalid/products/legacy-schema-one",
  capturedAt: createUtcTimestamp(new Date("2026-07-22T00:00:00.000Z")),
} satisfies SourceInfo;

assert.equal(completeSourceInfo.pageUrl.includes("legacy-schema-one"), true);
