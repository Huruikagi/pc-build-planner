import assert from "node:assert/strict";
import test from "node:test";

import {
  type AppDataError,
  type RequestId,
  type Revision,
  type Uuid,
  validateAppDataError,
} from "../../../src/domain/public.js";
import type { CandidateOperationError } from "../../../src/features/candidate-management/public.js";
import { createCandidateManagementService } from "../../../src/features/candidate-management/service.js";
import { createManagementState } from "../../../src/features/candidate-management/state.js";
import type { FoundationScopedDataPort } from "../../../src/persistence/public.js";

const requestId = "20000000-0000-4000-8000-000000000001" as Uuid as RequestId;

const characterization = [
  [
    { code: "validation", reason: "entity-not-found", message: "candidate" },
    "validation",
  ],
  [{ code: "corrupt-data", message: "corrupt" }, "unsupported-data"],
  [{ code: "unsupported-version", message: "future" }, "unsupported-data"],
  [{ code: "migration-failed", message: "migration" }, "unsupported-data"],
  [{ code: "repair-failed", message: "repair" }, "validation"],
  [{ code: "revision-conflict", message: "revision" }, "conflict"],
  [{ code: "request-conflict", message: "request" }, "conflict"],
  [{ code: "maintenance-active", message: "maintenance" }, "maintenance"],
  [{ code: "recovery-active", message: "recovery" }, "validation"],
  [{ code: "stale-recovery-state", message: "stale recovery" }, "validation"],
  [{ code: "stale-fence", message: "stale fence" }, "maintenance"],
  [{ code: "stale-assessment", message: "stale assessment" }, "validation"],
  [{ code: "precommit-cleanup-pending", message: "cleanup" }, "validation"],
  [{ code: "quota-exceeded", message: "quota" }, "quota"],
  [{ code: "access-denied", message: "access" }, "storage"],
  [{ code: "lock-unavailable", message: "lock" }, "storage"],
  [{ code: "storage-unavailable", message: "storage" }, "storage"],
] as const satisfies readonly (readonly [AppDataError, string])[];

test("共有data errorの全variant・payloadと既存service/state表示結果をcharacterizationする", async () => {
  for (const [error, expectedCode] of characterization) {
    const validated = validateAppDataError(error);
    assert.equal(validated.ok, true);
    if (!validated.ok) assert.fail("known AppDataError must validate");

    assert.strictEqual(validated.value, error);
    assert.deepEqual(validated.value, error);

    const data = {
      async query() {
        throw new Error("failed create must not query");
      },
      async mutate() {
        return { ok: false as const, error: validated.value };
      },
    } as unknown as FoundationScopedDataPort;
    const service = createCandidateManagementService({ data });
    const state = createManagementState({
      query: service,
      service,
      createMutationContext: () => ({
        requestId,
        expectedRevision: 0 as Revision,
      }),
    });

    await state.createProject("架空プロジェクト");

    assert.deepEqual(state.value.displayError, { code: expectedCode });
  }
});

test("候補field validationは共有AppDataErrorと判別キーを共有しない", () => {
  const validation = {
    kind: "candidate-validation",
    fields: { "product.name": "required" },
  } satisfies CandidateOperationError;
  const dataFailure = characterization[0][0] satisfies CandidateOperationError;

  assert.equal("kind" in validation, true);
  assert.equal("code" in validation, false);
  assert.equal("code" in dataFailure, true);
  assert.equal("kind" in dataFailure, false);
});
