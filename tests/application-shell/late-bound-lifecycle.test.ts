import assert from "node:assert/strict";
import test from "node:test";
import type { FeatureId } from "../../src/application-shell/contracts.js";
import { createLateBoundLifecycle } from "../../src/application-shell/late-bound-lifecycle.js";
import type { ActivationId } from "../../src/application-shell/transient-surface-ports.js";
import { ok } from "../../src/domain/public.js";

const activationId = "activation" as ActivationId;
const handoff = {
  featureId: "target" as FeatureId,
  target: "edit",
  payload: {},
};

test("同じport参照がbind前とunbind後にfail closedしbind中だけ委譲する", async () => {
  const lifecycle = createLateBoundLifecycle();
  const stablePort = lifecycle.port;
  assert.deepEqual(await stablePort.conclude(activationId, handoff), {
    ok: false,
    error: { kind: "not-started" },
  });
  let calls = 0;
  lifecycle.bind({
    isCurrent: (value) => value === activationId,
    dismiss: async () => ok(undefined),
    async conclude() {
      calls += 1;
      return ok(undefined);
    },
  });
  assert.equal(lifecycle.port, stablePort);
  assert.equal(stablePort.isCurrent(activationId), true);
  assert.equal((await stablePort.conclude(activationId, handoff)).ok, true);
  lifecycle.unbind();
  assert.equal(stablePort.isCurrent(activationId), false);
  assert.equal((await stablePort.conclude(activationId, handoff)).ok, false);
  assert.equal(calls, 1);
});
