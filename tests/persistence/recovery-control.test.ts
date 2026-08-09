import assert from "node:assert/strict";
import test from "node:test";
import {
  initialRecoveryControl,
  recoveryControlPolicy,
  validateRecoveryControl,
} from "../../src/persistence/recovery-control.js";

test("回復controlはgeneration/owner/leaseを永続値だけでfenceし、終了後だけ通常writeを許可する", () => {
  const acquired = recoveryControlPolicy.acquire(
    initialRecoveryControl(),
    "synthetic-owner",
    "2026-08-09T00:00:00.000Z",
  );
  assert.equal(acquired.ok, true);
  if (!acquired.ok) return;
  assert.deepEqual(
    recoveryControlPolicy.authorizeNormalWrite(acquired.value.control),
    { ok: false, error: { code: "recovery-active" } },
  );
  assert.deepEqual(
    recoveryControlPolicy.release(acquired.value.control, {
      generation: 0,
      ownerId: "synthetic-owner",
      leaseExpiresAt: "2026-08-09T00:00:00.000Z",
    }),
    { ok: false, error: { code: "stale-recovery-state" } },
  );
  const released = recoveryControlPolicy.release(
    acquired.value.control,
    acquired.value.fence,
  );
  assert.equal(released.ok, true);
  if (released.ok)
    assert.deepEqual(
      recoveryControlPolicy.authorizeNormalWrite(released.value),
      { ok: true, value: undefined },
    );
  assert.deepEqual(
    recoveryControlPolicy.release(acquired.value.control, {
      ...acquired.value.fence,
      leaseExpiresAt: "2026-08-09T00:01:00.000Z",
    }),
    { ok: false, error: { code: "stale-recovery-state" } },
  );
  const staleOwnerFence = {
    ...acquired.value.fence,
    ownerId: "different-owner",
  };
  assert.deepEqual(
    recoveryControlPolicy.authorizeRecovery(
      acquired.value.control,
      staleOwnerFence,
    ),
    { ok: false, error: { code: "stale-recovery-state" } },
  );
  assert.deepEqual(
    recoveryControlPolicy.release(acquired.value.control, staleOwnerFence),
    { ok: false, error: { code: "stale-recovery-state" } },
  );
  assert.deepEqual(
    recoveryControlPolicy.abort(acquired.value.control, staleOwnerFence),
    { ok: false, error: { code: "stale-recovery-state" } },
  );
});

test("不正または余剰fieldを含む回復controlはfail closedに拒否する", () => {
  assert.equal(
    validateRecoveryControl({
      generation: 1,
      active: true,
      ownerId: "owner",
      leaseExpiresAt: "bad",
    }).ok,
    false,
  );
  assert.equal(
    validateRecoveryControl({ generation: 0, active: false, leaked: true }).ok,
    false,
  );
});

test("期限切れleaseはowner・generationが一致しても回復commit認可とrenewを拒否する", () => {
  const acquired = recoveryControlPolicy.acquire(
    initialRecoveryControl(),
    "synthetic-owner",
    "2026-08-09T00:01:00.000Z",
  );
  assert.equal(acquired.ok, true);
  if (!acquired.ok) return;
  const expiredAt = "2026-08-09T00:01:00.001Z";
  assert.deepEqual(
    recoveryControlPolicy.authorizeRecovery(
      acquired.value.control,
      acquired.value.fence,
      expiredAt,
    ),
    { ok: false, error: { code: "stale-recovery-state" } },
  );
  assert.deepEqual(
    recoveryControlPolicy.renew(
      acquired.value.control,
      acquired.value.fence,
      "2026-08-09T00:02:00.000Z",
      expiredAt,
    ),
    { ok: false, error: { code: "stale-recovery-state" } },
  );
  assert.deepEqual(
    recoveryControlPolicy.release(
      acquired.value.control,
      acquired.value.fence,
      expiredAt,
    ),
    { ok: false, error: { code: "stale-recovery-state" } },
  );
  assert.deepEqual(
    recoveryControlPolicy.abort(
      acquired.value.control,
      acquired.value.fence,
      expiredAt,
    ),
    { ok: false, error: { code: "stale-recovery-state" } },
  );
});
