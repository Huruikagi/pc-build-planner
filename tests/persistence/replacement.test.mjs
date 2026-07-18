// @ts-nocheck replacement 境界へ意図的な旧 schema と破損値を渡す。
import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node 26 の type stripping で TypeScript source を直接検証する。
import { schemaValidator } from "../../src/domain/validation.ts";
// @ts-expect-error Node 26 の type stripping で TypeScript source を直接検証する。
import { createMigrationRegistry } from "../../src/persistence/migration-registry.ts";
// @ts-expect-error RED: ReplacementCoordinator はこの task で追加する。
import {
  canonicalJson,
  createReplacementCoordinator,
} from "../../src/persistence/replacement.ts";

const root = () => ({
  schemaVersion: 1,
  revision: 4,
  projects: [],
  candidateParts: [],
  currentBuilds: [],
  requestDedupe: [],
  maintenance: { generation: 0, active: false },
});

const coordinator = (
  migrations = createMigrationRegistry(1, [], schemaValidator),
) => createReplacementCoordinator(migrations, schemaValidator);
const cursor = {
  currentBytes: 80,
  quotaBytes: 10_000,
  revision: 7,
  maintenance: { generation: 0, active: false },
};

test("canonical JSON は object key を code point 順に再帰整列し array 順を保つ", () => {
  const highBmp = "\uE000";
  const astral = "\u{10000}";
  assert.equal(
    canonicalJson({
      z: { b: 2, a: 1 },
      list: [{ y: 2, x: 1 }],
      [highBmp]: 1,
      [astral]: 2,
    }),
    `{"list":[{"x":1,"y":2}],"z":{"a":1,"b":2},"${highBmp}":1,"${astral}":2}`,
  );
});

test("同じ候補と cursor は安定し、候補・schema・bytes・revision の差を token に含める", async () => {
  const candidate = root();
  const first = await coordinator().assessReplacement(candidate, cursor);
  const reordered = await coordinator().assessReplacement(
    {
      maintenance: candidate.maintenance,
      requestDedupe: [],
      currentBuilds: [],
      candidateParts: [],
      projects: [],
      revision: 4,
      schemaVersion: 1,
    },
    cursor,
  );
  assert.equal(first.ok, true);
  assert.equal(reordered.ok, true);
  assert.equal(first.value.token, reordered.value.token);
  assert.match(first.value.candidateDigest, /^[0-9a-f]{64}$/);

  const changedCandidate = await coordinator().assessReplacement(
    { ...candidate, revision: 5 },
    cursor,
  );
  const changedRevision = await coordinator().assessReplacement(candidate, {
    ...cursor,
    revision: 8,
  });
  assert.equal(changedCandidate.ok, true);
  assert.equal(changedCandidate.value.token, first.value.token);
  assert.equal(changedRevision.ok, true);
  assert.notEqual(changedRevision.value.token, first.value.token);

  const oldRegistry = createMigrationRegistry(
    1,
    [
      {
        from: 0,
        to: 1,
        migrate: (input) => ({
          ok: true,
          value: { ...root(), revision: input.revision },
        }),
      },
    ],
    schemaValidator,
  );
  const changedSchema = await coordinator(oldRegistry).assessReplacement(
    { schemaVersion: 0, revision: 4 },
    cursor,
  );
  assert.equal(changedSchema.ok, true);
  assert.notEqual(changedSchema.value.token, first.value.token);
  assert.equal(changedSchema.value.sourceSchemaVersion, 0);
  assert.equal(changedSchema.value.targetSchemaVersion, 1);
});

test("移行・全体検証・容量評価は候補も永続状態も変更しない", async () => {
  const candidate = root();
  const before = structuredClone(candidate);
  const success = await coordinator().assessReplacement(candidate, cursor);
  assert.equal(success.ok, true);
  assert.deepEqual(candidate, before);
  assert.equal(
    success.value.requiredBytes,
    new TextEncoder().encode(JSON.stringify({ localDataRoot: candidate }))
      .byteLength,
  );
  assert.equal(success.value.beforeBytes, cursor.currentBytes);

  const invalid = await coordinator().assessReplacement(
    { ...candidate, projects: [{}] },
    cursor,
  );
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, "validation");
  const overQuota = await coordinator().assessReplacement(candidate, {
    ...cursor,
    quotaBytes: 1,
  });
  assert.deepEqual(overQuota, { ok: false, error: { code: "quota-exceeded" } });
});
