import assert from "node:assert/strict";
import test from "node:test";
import {
  type AppDataError,
  type FoundationError,
  type FoundationErrorCode,
  mapFoundationError,
  validateAppDataError,
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
  "stale-recovery-state": {
    code: "stale-recovery-state",
    message: "recovery state",
  },
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
} as const satisfies Record<FoundationErrorCode, FoundationError>;

test("公開mapperは全FoundationError variantのcodeとpayloadを一対一で保持する", () => {
  for (const error of Object.values(errors)) {
    assert.deepEqual(mapFoundationError(error), error);
  }
});

test("公開consumerはAppDataErrorをcodeでexhaustiveに判別できる", () => {
  const classify = (error: AppDataError): FoundationErrorCode => {
    switch (error.code) {
      case "validation":
      case "corrupt-data":
      case "unsupported-version":
      case "migration-failed":
      case "repair-failed":
      case "revision-conflict":
      case "request-conflict":
      case "maintenance-active":
      case "recovery-active":
      case "stale-recovery-state":
      case "stale-fence":
      case "stale-assessment":
      case "precommit-cleanup-pending":
      case "quota-exceeded":
      case "access-denied":
      case "lock-unavailable":
      case "storage-unavailable":
        return error.code;
      default:
        return error satisfies never;
    }
  };
  assert.equal(classify(errors.validation), "validation");
});

test("unknown境界値は既知errorへ畳み込まずtyped validation failureにする", () => {
  for (const input of [
    null,
    {},
    { code: "storage-unavailable", message: 1 },
    { code: "future-error" },
  ]) {
    const result = validateAppDataError(input);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "invalid-app-data-error");
  }
});

test("例外を送出する未信頼objectもtyped validation failureとして観測できる", () => {
  const hostile = Object.defineProperty({}, "code", {
    enumerable: true,
    get(): never {
      throw new Error("hostile getter");
    },
  });
  assert.deepEqual(validateAppDataError(hostile), {
    ok: false,
    error: {
      code: "invalid-app-data-error",
      reason: "invalid-payload",
      path: "$",
    },
  });
});

test("境界validatorは完全な既知variantだけを受理しpayloadを保持する", () => {
  for (const error of Object.values(errors)) {
    assert.deepEqual(validateAppDataError(error), { ok: true, value: error });
  }
});
