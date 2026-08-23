import assert from "node:assert/strict";
import test from "node:test";
import {
  type CandidateSourcePublicError,
  projectAppDataError,
} from "../../src/candidate-sources/public.js";
import type {
  AppDataError,
  FoundationErrorCode,
} from "../../src/domain/public.js";

const errors = {
  validation: {
    code: "validation",
    reason: "entity-not-found",
    message: "candidate",
  },
  "corrupt-data": { code: "corrupt-data", message: "corrupt" },
  "unsupported-version": { code: "unsupported-version", message: "future" },
  "migration-failed": { code: "migration-failed", message: "migration" },
  "repair-failed": { code: "repair-failed", message: "repair" },
  "revision-conflict": { code: "revision-conflict", message: "revision" },
  "request-conflict": { code: "request-conflict", message: "request" },
  "maintenance-active": { code: "maintenance-active", message: "maintenance" },
  "recovery-active": { code: "recovery-active", message: "recovery" },
  "stale-recovery-state": { code: "stale-recovery-state", message: "state" },
  "stale-fence": { code: "stale-fence", message: "fence" },
  "stale-assessment": { code: "stale-assessment", message: "assessment" },
  "precommit-cleanup-pending": {
    code: "precommit-cleanup-pending",
    message: "cleanup",
  },
  "quota-exceeded": { code: "quota-exceeded", message: "quota" },
  "access-denied": { code: "access-denied", message: "access" },
  "lock-unavailable": { code: "lock-unavailable", message: "lock" },
  "storage-unavailable": { code: "storage-unavailable", message: "storage" },
} as const satisfies Record<FoundationErrorCode, AppDataError>;

test("全AppDataError variantのcode・payload・contextを一対一で保持する", () => {
  for (const error of Object.values(errors)) {
    const projected = projectAppDataError(error);
    assert.deepEqual(projected, { kind: "data", error });
    assert.strictEqual(projected.error, error);
  }
});

test("source固有errorはdata errorへ吸収されず既存表示粒度で判別できる", () => {
  const errors = [
    {
      kind: "source-validation",
      path: "sources[0].pageUrl",
      reason: "invalid-format",
    },
    { kind: "not-found", entity: "candidate" },
    { kind: "not-found", entity: "source" },
    { kind: "primary-required" },
    { kind: "precondition-failed" },
    { kind: "source-identity-failure", reason: "unsafe-scheme" },
  ] as const satisfies readonly CandidateSourcePublicError[];

  assert.deepEqual(
    errors.map((error) => error.kind),
    [
      "source-validation",
      "not-found",
      "not-found",
      "primary-required",
      "precondition-failed",
      "source-identity-failure",
    ],
  );
});
