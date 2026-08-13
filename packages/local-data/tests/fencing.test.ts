import assert from "node:assert/strict";
import test from "node:test";

import {
  createFencingPolicy,
  type FenceControlState,
  type FencingProjection,
} from "../src/fencing.js";

interface SyntheticRoot {
  readonly revision: number;
  readonly control: unknown;
  readonly payload: string;
}

const inactive = (generation = 0): FenceControlState => ({
  active: false,
  generation,
});

const projection: FencingProjection<SyntheticRoot> = {
  revision: (root) => root.revision,
  read: (root) => root.control,
  write: (root, control) => ({ ...root, control }),
};

const policy = createFencingPolicy(projection);

test("acquire persists an owner, a new generation, lease, kind, and revision", () => {
  const root = { revision: 4, control: inactive(7), payload: "kept" };
  const result = policy.acquire(root, {
    kind: "maintenance",
    owner: "worker-a",
    leaseMs: 1_000,
    now: 5_000,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.fence, {
    kind: "maintenance",
    owner: "worker-a",
    generation: 8,
    leaseExpiresAt: 6_000,
    revision: 4,
  });
  assert.deepEqual(result.value.root.control, {
    active: true,
    kind: "maintenance",
    owner: "worker-a",
    generation: 8,
    leaseExpiresAt: 6_000,
    revision: 4,
  });
  assert.equal(result.value.root.payload, "kept");
});

test("only the first acquire against the latest persisted control succeeds", () => {
  const root = { revision: 2, control: inactive(), payload: "root" };
  const first = policy.acquire(root, {
    kind: "maintenance",
    owner: "worker-a",
    leaseMs: 500,
    now: 100,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;

  assert.deepEqual(
    policy.acquire(first.value.root, {
      kind: "maintenance",
      owner: "worker-b",
      leaseMs: 500,
      now: 100,
    }),
    { ok: false, error: { code: "maintenance-active" } },
  );
});

test("a regenerated policy rejects ownerless and foreign-owner writes from persisted state", () => {
  const root: SyntheticRoot = {
    revision: 9,
    control: {
      active: true,
      kind: "recovery",
      owner: "restore-a",
      generation: 3,
      leaseExpiresAt: 8_000,
      revision: 9,
    },
    payload: "persistent",
  };
  const regenerated = createFencingPolicy(projection);

  assert.deepEqual(regenerated.authorizeMutation(root, undefined, 7_000), {
    ok: false,
    error: { code: "recovery-active" },
  });
  assert.deepEqual(
    regenerated.authorizeMutation(
      root,
      {
        kind: "recovery",
        owner: "restore-b",
        generation: 3,
        leaseExpiresAt: 8_000,
        revision: 9,
      },
      7_000,
    ),
    { ok: false, error: { code: "stale-fence" } },
  );
});

test("stale generation, revision, and expired leases fail closed", () => {
  const active: FenceControlState = {
    active: true,
    kind: "maintenance",
    owner: "worker-a",
    generation: 5,
    leaseExpiresAt: 2_000,
    revision: 12,
  };
  const root = { revision: 12, control: active, payload: "root" };

  for (const fence of [
    { ...active, generation: 4 },
    { ...active, revision: 11 },
  ]) {
    assert.deepEqual(policy.authorizeMutation(root, fence, 1_000), {
      ok: false,
      error: { code: "stale-fence" },
    });
  }
  assert.deepEqual(policy.authorizeMutation(root, active, 2_000), {
    ok: false,
    error: { code: "stale-fence" },
  });
  assert.deepEqual(policy.renew(root, active, 500, 2_000), {
    ok: false,
    error: { code: "stale-fence" },
  });
});

test("renew extends only the current fence and preserves its generation", () => {
  const root: SyntheticRoot = {
    revision: 6,
    control: {
      active: true,
      kind: "maintenance",
      owner: "worker-a",
      generation: 2,
      leaseExpiresAt: 1_000,
      revision: 6,
    },
    payload: "root",
  };
  const fence = root.control as Exclude<FenceControlState, { active: false }>;
  const result = policy.renew(root, fence, 2_000, 900);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.fence.generation, 2);
  assert.equal(result.value.fence.leaseExpiresAt, 2_900);
});

test("only release or abort with the current fence resumes ordinary mutation", () => {
  const active: Exclude<FenceControlState, { active: false }> = {
    active: true,
    kind: "maintenance",
    owner: "worker-a",
    generation: 4,
    leaseExpiresAt: 5_000,
    revision: 10,
  };
  const root = { revision: 10, control: active, payload: "root" };

  for (const finish of [policy.release, policy.abort]) {
    const finished = finish(root, active);
    assert.equal(finished.ok, true);
    if (!finished.ok) continue;
    assert.deepEqual(finished.value.root.control, inactive(4));
    assert.deepEqual(
      policy.authorizeMutation(finished.value.root, undefined, 6_000),
      { ok: true, value: undefined },
    );
  }

  assert.deepEqual(
    policy.release(root, { ...active, owner: "worker-b" }),
    { ok: false, error: { code: "stale-fence" } },
  );
  assert.deepEqual(policy.authorizeMutation(root, undefined, 6_000), {
    ok: false,
    error: { code: "maintenance-active" },
  });
});

test("corrupt persisted control and invalid time inputs fail closed", () => {
  const corrupt = { revision: 1, control: { active: true }, payload: "root" };

  assert.deepEqual(policy.authorizeMutation(corrupt, undefined, 0), {
    ok: false,
    error: { code: "stale-fence" },
  });
  assert.deepEqual(
    policy.acquire(
      { revision: 1, control: inactive(), payload: "root" },
      { kind: "maintenance", owner: "worker", leaseMs: 0, now: 0 },
    ),
    { ok: false, error: { code: "stale-fence" } },
  );
});

test("an active control whose persisted revision disagrees with the root fails closed", () => {
  const control: Exclude<FenceControlState, { active: false }> = {
    active: true,
    kind: "maintenance",
    owner: "worker-a",
    generation: 6,
    leaseExpiresAt: 500,
    revision: 3,
  };
  const root = { revision: 4, control, payload: "unchanged" };

  assert.deepEqual(
    policy.acquire(root, {
      kind: "maintenance",
      owner: "worker-b",
      leaseMs: 1_000,
      now: 500,
    }),
    { ok: false, error: { code: "stale-fence" } },
  );
  assert.deepEqual(policy.renew(root, control, 1_000, 100), {
    ok: false,
    error: { code: "stale-fence" },
  });
  assert.deepEqual(policy.release(root, control), {
    ok: false,
    error: { code: "stale-fence" },
  });
  assert.deepEqual(policy.abort(root, control), {
    ok: false,
    error: { code: "stale-fence" },
  });
  assert.deepEqual(policy.authorizeMutation(root, control, 100), {
    ok: false,
    error: { code: "stale-fence" },
  });
  assert.deepEqual(root, { revision: 4, control, payload: "unchanged" });
});
