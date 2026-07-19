// @ts-nocheck runtime境界へ不正値も渡してfail-closedを検証する。
import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import { maintenancePolicy } from "../../src/persistence/maintenance.ts";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import { createInitialRoot } from "../../src/persistence/schema.ts";

const OWNER_A = "00000000-0000-4000-8000-0000000000a1";
const OWNER_B = "00000000-0000-4000-8000-0000000000b2";
const NOW = "2030-01-01T00:00:00.000Z";
const LATER = "2030-01-01T00:00:00.101Z";

const commit = (transition) => ({
  ...transition.root,
  revision: transition.fence?.revision ?? transition.root.revision + 1,
});

test("acquireはgenerationを進め、ownerだけに有効な永続fence候補を返す", () => {
  const root = createInitialRoot();
  const acquired = maintenancePolicy.acquire(root, OWNER_A, 100, NOW);
  assert.equal(acquired.ok, true);
  assert.equal(root.maintenance.active, false, "入力rootを変更しない");
  assert.equal(acquired.value.root.maintenance.generation, 1);
  assert.equal(acquired.value.fence.revision, root.revision + 1);
  const persisted = commit(acquired.value);
  assert.equal(
    maintenancePolicy.authorizeWrite(persisted, undefined, NOW).error.code,
    "maintenance-active",
  );
  assert.equal(
    maintenancePolicy.authorizeWrite(
      persisted,
      { ...acquired.value.fence, ownerId: OWNER_B },
      NOW,
    ).error.code,
    "stale-fence",
  );
  assert.equal(
    maintenancePolicy.authorizeWrite(persisted, acquired.value.fence, NOW).ok,
    true,
  );
});

test("有効leaseの再acquireを拒否し、期限切れleaseは新generationだけ許可する", () => {
  const first = maintenancePolicy.acquire(
    createInitialRoot(),
    OWNER_A,
    100,
    NOW,
  );
  const active = commit(first.value);
  assert.equal(
    maintenancePolicy.acquire(active, OWNER_B, 100, NOW).error.code,
    "maintenance-active",
  );
  assert.equal(
    maintenancePolicy.authorizeWrite(active, first.value.fence, LATER).error
      .code,
    "stale-fence",
  );
  assert.equal(
    maintenancePolicy.renew(active, first.value.fence, 100, LATER).error.code,
    "stale-fence",
  );
  const reacquired = maintenancePolicy.acquire(active, OWNER_A, 100, LATER);
  assert.equal(reacquired.ok, true);
  assert.equal(reacquired.value.fence.generation, 2);
});

test("renewは最新generation owner revisionのみ受け付け次revisionのfenceを返す", () => {
  const first = maintenancePolicy.acquire(
    createInitialRoot(),
    OWNER_A,
    100,
    NOW,
  );
  const active = commit(first.value);
  for (const stale of [
    { ...first.value.fence, generation: 0 },
    { ...first.value.fence, ownerId: OWNER_B },
    { ...first.value.fence, revision: first.value.fence.revision - 1 },
  ]) {
    assert.equal(
      maintenancePolicy.renew(active, stale, 200, NOW).error.code,
      "stale-fence",
    );
  }
  const renewed = maintenancePolicy.renew(active, first.value.fence, 200, NOW);
  assert.equal(renewed.ok, true);
  assert.equal(renewed.value.fence.revision, active.revision + 1);
  assert.equal(
    renewed.value.root.maintenance.leaseExpiresAt,
    "2030-01-01T00:00:00.200Z",
  );
});

test("valid release/abort候補をcommitした後だけ通常writeを再開する", () => {
  for (const operation of ["release", "abort"]) {
    const acquired = maintenancePolicy.acquire(
      createInitialRoot(),
      OWNER_A,
      100,
      NOW,
    );
    const active = commit(acquired.value);
    assert.equal(
      maintenancePolicy[operation](active, {
        ...acquired.value.fence,
        ownerId: OWNER_B,
      }).error.code,
      "stale-fence",
    );
    assert.equal(
      maintenancePolicy.authorizeWrite(active, undefined, NOW).error.code,
      "maintenance-active",
    );
    const finished = maintenancePolicy[operation](active, acquired.value.fence);
    assert.equal(finished.ok, true);
    const inactive = commit(finished.value);
    assert.equal(
      maintenancePolicy.authorizeWrite(inactive, undefined, NOW).ok,
      true,
    );
    assert.equal(
      maintenancePolicy.authorizeWrite(inactive, acquired.value.fence, NOW)
        .error.code,
      "stale-fence",
    );
  }
});

test("abortはreceiverへ依存せずreleaseと同じ遷移候補を返す", () => {
  const acquired = maintenancePolicy.acquire(
    createInitialRoot(),
    OWNER_A,
    100,
    NOW,
  );
  const active = commit(acquired.value);
  const { abort } = maintenancePolicy;
  const aborted = abort(active, acquired.value.fence);
  assert.equal(aborted.ok, true);
  assert.deepEqual(
    aborted.value,
    maintenancePolicy.release(active, acquired.value.fence).value,
  );
});

test("破損maintenance stateとrevisionを全操作でfail closed拒否する", () => {
  const corruptRoots = [
    { ...createInitialRoot(), revision: -1 },
    { ...createInitialRoot(), maintenance: { generation: -1, active: false } },
    {
      ...createInitialRoot(),
      maintenance: { generation: 0, active: false, ownerId: OWNER_A },
    },
    { ...createInitialRoot(), maintenance: { generation: 1, active: true } },
    {
      ...createInitialRoot(),
      maintenance: {
        generation: 1,
        active: true,
        ownerId: "invalid",
        leaseExpiresAt: "invalid",
      },
    },
  ];
  const fence = { generation: 1, ownerId: OWNER_A, revision: 0 };
  for (const root of corruptRoots) {
    assert.equal(
      maintenancePolicy.acquire(root, OWNER_A, 100, NOW).error.code,
      "corrupt-data",
    );
    assert.equal(
      maintenancePolicy.renew(root, fence, 100, NOW).error.code,
      "corrupt-data",
    );
    assert.equal(
      maintenancePolicy.release(root, fence).error.code,
      "corrupt-data",
    );
    assert.equal(
      maintenancePolicy.abort(root, fence).error.code,
      "corrupt-data",
    );
    assert.equal(
      maintenancePolicy.authorizeWrite(root, fence, NOW).error.code,
      "corrupt-data",
    );
  }
});

test("lease入力と時刻入力を検証し候補を返さない", () => {
  const root = createInitialRoot();
  for (const lease of [0, -1, 1.5, Number.MAX_SAFE_INTEGER]) {
    assert.equal(
      maintenancePolicy.acquire(root, OWNER_A, lease, NOW).error.code,
      "validation",
    );
  }
  assert.equal(
    maintenancePolicy.acquire(root, OWNER_A, 100, "invalid").error.code,
    "validation",
  );
  assert.equal(
    maintenancePolicy.authorizeWrite(root, undefined, "invalid").error.code,
    "validation",
  );
});
