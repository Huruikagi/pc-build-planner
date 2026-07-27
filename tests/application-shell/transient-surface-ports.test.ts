import assert from "node:assert/strict";
import test from "node:test";
import { parseTargetTabId } from "../../src/application-shell/public.js";

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
