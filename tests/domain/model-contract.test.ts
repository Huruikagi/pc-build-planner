import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import { createRevision } from "../../src/domain/identifiers.ts";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import * as schema from "../../src/persistence/schema.ts";

const { createInitialRoot, CURRENT_SCHEMA_VERSION, REQUEST_DEDUPE_LIMIT } =
  schema;

/** @type {import("../../src/domain/model.ts").LocalDataRoot} */
const syntheticRoot = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  revision: createRevision(7),
  projects: [
    {
      id: /** @type {import("../../src/domain/model.ts").ProjectId} */ (
        "11111111-1111-4111-8111-111111111111"
      ),
      name: "架空ワークステーション",
      createdAt:
        /** @type {import("../../src/domain/identifiers.ts").UtcTimestamp} */ (
          "2026-07-18T01:00:00.000Z"
        ),
      updatedAt:
        /** @type {import("../../src/domain/identifiers.ts").UtcTimestamp} */ (
          "2026-07-18T02:00:00.000Z"
        ),
    },
  ],
  candidateParts: [
    {
      id: /** @type {import("../../src/domain/model.ts").CandidatePartId} */ (
        "22222222-2222-4222-8222-222222222222"
      ),
      projectId: /** @type {import("../../src/domain/model.ts").ProjectId} */ (
        "11111111-1111-4111-8111-111111111111"
      ),
      category: "cpu",
      product: { name: { original: "架空CPU", confirmed: "Example CPU" } },
      sources: [
        {
          id: /** @type {import("../../src/domain/model.ts").CandidateSourceId} */ (
            "66666666-6666-4666-8666-666666666666"
          ),
          pageUrl: "https://example.invalid/products/cpu-1",
          capturedAt:
            /** @type {import("../../src/domain/identifiers.ts").UtcTimestamp} */ (
              "2026-07-18T01:30:00.000Z"
            ),
        },
      ],
      primarySourceId:
        /** @type {import("../../src/domain/model.ts").CandidateSourceId} */ (
          "66666666-6666-4666-8666-666666666666"
        ),
      normalizedAttributes: {
        category: "cpu",
        socket: { original: "EX-1", confirmed: "EX-1" },
      },
      createdAt:
        /** @type {import("../../src/domain/identifiers.ts").UtcTimestamp} */ (
          "2026-07-18T01:30:00.000Z"
        ),
      updatedAt:
        /** @type {import("../../src/domain/identifiers.ts").UtcTimestamp} */ (
          "2026-07-18T01:30:00.000Z"
        ),
    },
  ],
  currentBuilds: [
    {
      id: /** @type {import("../../src/domain/model.ts").CurrentBuildId} */ (
        "33333333-3333-4333-8333-333333333333"
      ),
      projectId: /** @type {import("../../src/domain/model.ts").ProjectId} */ (
        "11111111-1111-4111-8111-111111111111"
      ),
      items: [
        {
          candidatePartId:
            /** @type {import("../../src/domain/model.ts").CandidatePartId} */ (
              "22222222-2222-4222-8222-222222222222"
            ),
          quantity:
            /** @type {import("../../src/domain/model.ts").PositiveInteger} */ (
              1
            ),
        },
      ],
      updatedAt:
        /** @type {import("../../src/domain/identifiers.ts").UtcTimestamp} */ (
          "2026-07-18T02:00:00.000Z"
        ),
    },
  ],
  requestDedupe: [
    {
      requestId:
        /** @type {import("../../src/domain/identifiers.ts").RequestId} */ (
          "44444444-4444-4444-8444-444444444444"
        ),
      payloadDigest: "sha256:synthetic-request",
      committedRevision: createRevision(7),
    },
  ],
  maintenance: {
    generation:
      /** @type {import("../../src/domain/model.ts").MaintenanceGeneration} */ (
        3
      ),
    active: true,
    ownerId:
      /** @type {import("../../src/domain/model.ts").MaintenanceOwnerId} */ (
        "55555555-5555-4555-8555-555555555555"
      ),
    leaseExpiresAt:
      /** @type {import("../../src/domain/identifiers.ts").UtcTimestamp} */ (
        "2026-07-18T03:00:00.000Z"
      ),
  },
};

test("aggregate rootは同一project参照と永続制御stateをJSON往復できる", () => {
  assert.equal(syntheticRoot.currentBuilds[0]?.items[0]?.quantity, 1);
  assert.equal(syntheticRoot.maintenance.active, true);
  assert.deepEqual(JSON.parse(JSON.stringify(syntheticRoot)), syntheticRoot);
});

test("初期rootは空aggregateと永続maintenance generationを持つ", () => {
  assert.equal(REQUEST_DEDUPE_LIMIT > 0, true);
  assert.deepEqual(createInitialRoot(), {
    schemaVersion: 1,
    revision: 0,
    projects: [],
    candidateParts: [],
    currentBuilds: [],
    requestDedupe: [],
    maintenance: { generation: 0, active: false },
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(createInitialRoot())),
    createInitialRoot(),
  );
});
