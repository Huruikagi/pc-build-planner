import assert from "node:assert/strict";
import test from "node:test";
import type {
  ActivationId,
  FeatureActivationIntent,
} from "../../../src/application-shell/public.js";
import { ok } from "../../../src/domain/public.js";
import type { CaptureResult } from "../../../src/features/product-capture/contracts.js";
import { createCandidateEditorHandoff } from "../../../src/features/product-capture/editor-handoff.js";

const result = {
  requestId: "70000000-0000-4000-8000-000000000001",
  tabId: 1,
  pageUrl: "https://example.invalid/item",
  capturedAt: "2026-07-28T00:00:00.000Z",
  draft: { fields: [], missingCoreFields: [] },
  rejectedFields: [{ field: "price", reason: "invalid-format" }],
} as unknown as CaptureResult;

test("CandidateEditorHandoffがintent生成と同じretained intentのretryを所有する", async () => {
  const concluded: FeatureActivationIntent[] = [];
  const handoff = createCandidateEditorHandoff({
    createCandidateEditorIntent: (prefill) => ({
      featureId: "candidate-management" as never,
      target: "open-candidate-editor",
      payload: prefill,
    }),
    conclude: async (_activationId, intent) => {
      concluded.push(intent);
      return ok(undefined);
    },
  });
  const prepared = handoff.prepare(result);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  assert.deepEqual(
    (prepared.value.payload as { captureDiagnostics: unknown })
      .captureDiagnostics,
    result.rejectedFields,
  );
  await handoff.conclude("activation" as ActivationId, prepared.value);
  await handoff.retry("activation" as ActivationId, prepared.value);
  assert.equal(concluded[0], concluded[1]);
});
