import assert from "node:assert/strict";
import test from "node:test";
import { parseTargetTabId } from "../../src/application-shell/public.js";
import { transientHandoffFailure } from "../../src/application-shell/transient-surface-ports.js";

test("parseTargetTabId accepts only positive safe integers", () => {
  const accepted = parseTargetTabId(1);
  assert.equal(accepted.ok, true);
  if (accepted.ok) assert.equal(accepted.value, 1);

  for (const value of [
    undefined,
    null,
    0,
    -1,
    1.5,
    Number.NaN,
    Infinity,
    "1",
  ]) {
    assert.deepEqual(parseTargetTabId(value), {
      ok: false,
      error: { kind: "invalid-target-tab" },
    });
  }
});

test("shell activation失敗をpayload非依存のhandoff理由へ写像する", () => {
  assert.deepEqual(transientHandoffFailure(undefined), {
    kind: "transition-failed",
    reason: "host-unavailable",
  });
  assert.deepEqual(
    transientHandoffFailure({
      kind: "invalid_activation",
      detail: "unsafe payload detail",
    }),
    { kind: "transition-failed", reason: "invalid-handoff" },
  );
  assert.deepEqual(
    transientHandoffFailure({
      kind: "activation_failed",
      detail: "unsafe feature detail",
      reason: "operation-blocked",
    }),
    { kind: "transition-failed", reason: "operation-blocked" },
  );
  assert.equal(
    JSON.stringify(
      transientHandoffFailure({
        kind: "activation_failed",
        detail: "secret extracted value",
      }),
    ).includes("secret"),
    false,
  );
});
