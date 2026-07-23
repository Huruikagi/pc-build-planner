import assert from "node:assert/strict";
import test from "node:test";
import type {
  CandidatePartId,
  ProjectId,
  UtcTimestamp,
  Uuid,
} from "../../../src/domain/public.js";
import type {
  AggregateStatus,
  CompatibilityError,
  CompatibilityReport,
  RuleId,
  RuleResult,
  RuleStatus,
} from "../../../src/features/compatibility/contracts.js";
import {
  AGGREGATE_STATUSES,
  RULE_IDS,
} from "../../../src/features/compatibility/contracts.js";

const projectId = "3d3e3f3a-0000-4000-8000-000000000001" as Uuid as ProjectId;
const candidatePartId =
  "3d3e3f3a-0000-4000-8000-000000000002" as Uuid as CandidatePartId;
const updatedAt = "2026-07-24T00:00:00.000Z" as unknown as UtcTimestamp;

test("RULE_IDS enumerates exactly the five fixed rules", () => {
  const expected: readonly RuleId[] = [
    "cpu-motherboard-socket",
    "motherboard-memory-ddr",
    "cooler-cpu-socket",
    "case-motherboard-form-factor",
    "case-psu-form-factor",
  ];
  assert.deepEqual([...RULE_IDS].sort(), [...expected].sort());
  assert.equal(new Set(RULE_IDS).size, 5);
});

test("AGGREGATE_STATUSES enumerates exactly the four aggregate categories", () => {
  const expected: readonly AggregateStatus[] = [
    "compatible",
    "incompatible",
    "caution",
    "unknown",
  ];
  assert.deepEqual([...AGGREGATE_STATUSES].sort(), [...expected].sort());
  assert.equal(new Set(AGGREGATE_STATUSES).size, 4);
});

test("individual RuleStatus and aggregate AggregateStatus are distinct sets", () => {
  const ruleStatuses: readonly RuleStatus[] = [
    "compatible",
    "incompatible",
    "unknown",
  ];
  assert.ok(!ruleStatuses.includes("caution" as RuleStatus));
  assert.ok(AGGREGATE_STATUSES.includes("caution"));
});

test("a decided RuleResult carries compared values and both parties", () => {
  const buildDecided = (): RuleResult => ({
    ruleId: "cpu-motherboard-socket",
    status: "compatible",
    left: { candidatePartId, displayName: "架空CPU" },
    right: { candidatePartId, displayName: "架空マザーボード" },
    comparedValue: { left: "AM5", right: "AM5" },
    reasonCode: "socket-match",
  });
  const decided = buildDecided();
  if (decided.status === "compatible" || decided.status === "incompatible") {
    assert.equal(decided.comparedValue.left, "AM5");
  } else {
    assert.fail("expected a decided status");
  }
});

test("an unknown RuleResult carries missing fields instead of compared values", () => {
  const unknown: RuleResult = {
    ruleId: "motherboard-memory-ddr",
    status: "unknown",
    left: { candidatePartId, displayName: "架空マザーボード" },
    missingFields: [{ side: "right", reason: "category-missing" }],
    reasonCode: "memory-missing",
  };
  assert.equal(unknown.status, "unknown");
  if (unknown.status === "unknown") {
    assert.equal(unknown.missingFields.length, 1);
    assert.equal(unknown.missingFields[0]?.reason, "category-missing");
  }
});

test("CompatibilityReport is a read-only derived snapshot reusing upstream id/time types", () => {
  const report: CompatibilityReport = {
    projectId,
    buildUpdatedAt: updatedAt,
    status: "caution",
    results: [],
  };
  assert.equal(report.projectId, projectId);
  assert.equal(report.buildUpdatedAt, updatedAt);
  assert.equal(report.status, "caution");
  assert.deepEqual(report.results, []);
});

test("CompatibilityError distinguishes read failures from result statuses", () => {
  const errors: readonly CompatibilityError[] = [
    { kind: "no-build" },
    { kind: "invalid-reference" },
    { kind: "corrupt-data" },
    { kind: "unsupported-data" },
    { kind: "read-failed" },
  ];
  assert.equal(new Set(errors.map((error) => error.kind)).size, 5);
});

test("exhaustive switches over RuleId, RuleStatus, AggregateStatus, and CompatibilityError typecheck", () => {
  const exhaustiveRuleId = (id: RuleId): string => {
    switch (id) {
      case "cpu-motherboard-socket":
      case "motherboard-memory-ddr":
      case "cooler-cpu-socket":
      case "case-motherboard-form-factor":
      case "case-psu-form-factor":
        return id;
      default: {
        const never_: never = id;
        return never_;
      }
    }
  };

  const exhaustiveRuleStatus = (status: RuleStatus): string => {
    switch (status) {
      case "compatible":
      case "incompatible":
      case "unknown":
        return status;
      default: {
        const never_: never = status;
        return never_;
      }
    }
  };

  const exhaustiveAggregateStatus = (status: AggregateStatus): string => {
    switch (status) {
      case "compatible":
      case "incompatible":
      case "caution":
      case "unknown":
        return status;
      default: {
        const never_: never = status;
        return never_;
      }
    }
  };

  const exhaustiveCompatibilityError = (error: CompatibilityError): string => {
    switch (error.kind) {
      case "no-build":
      case "invalid-reference":
      case "corrupt-data":
      case "unsupported-data":
      case "read-failed":
        return error.kind;
      default: {
        const never_: never = error;
        return never_;
      }
    }
  };

  for (const id of RULE_IDS) {
    assert.equal(exhaustiveRuleId(id), id);
  }
  for (const status of ["compatible", "incompatible", "unknown"] as const) {
    assert.equal(exhaustiveRuleStatus(status), status);
  }
  for (const status of AGGREGATE_STATUSES) {
    assert.equal(exhaustiveAggregateStatus(status), status);
  }
  assert.equal(exhaustiveCompatibilityError({ kind: "no-build" }), "no-build");
});
