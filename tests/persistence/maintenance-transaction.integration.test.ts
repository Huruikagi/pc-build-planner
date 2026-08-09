// @ts-nocheck Node 26のtype strippingでTypeScript sourceを直接検証する。
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    // Only project sources are type-stripped. A package resolves its own
    // `.js` specifiers against the files it actually ships.
    const typeStripped =
      specifier.endsWith(".js") &&
      !(context.parentURL ?? "").includes("/node_modules/");
    return nextResolve(
      typeStripped ? `${specifier.slice(0, -3)}.ts` : specifier,
      context,
    );
  },
});

// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import { schemaValidator } from "../../src/domain/validation.ts";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import { maintenancePolicy } from "../../src/persistence/maintenance.ts";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import { createMigrationRegistry } from "../../src/persistence/migration-registry.ts";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import { createInMemoryRootWriteLock } from "../../src/persistence/root-write-lock.ts";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import { createInitialRoot } from "../../src/persistence/schema.ts";

const { createRootTransactionRunner } = await import(
  "../../src/persistence/root-transaction-runner.ts"
);

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-07-19T00:00:00Z";

const createSharedHarness = () => {
  let stored = createInitialRoot();
  let writes = 0;
  const storage = {
    async readRoot() {
      return { ok: true, value: structuredClone(stored) };
    },
    async bytesInUse() {
      return { ok: true, value: 0 };
    },
    quotaBytes() {
      return 10_000;
    },
    async writeRoot(root) {
      writes += 1;
      stored = structuredClone(root);
      return { ok: true, value: undefined };
    },
    async readRecoveryControl() {
      return { ok: true, value: undefined };
    },
    async writeRecoveryControl() {
      assert.fail("normal maintenance must not write recovery control");
    },
    async restrictToTrustedContexts() {
      return { ok: true, value: undefined };
    },
  };
  const migrations = createMigrationRegistry(1, [], schemaValidator);
  const lock = createInMemoryRootWriteLock();
  const createRunner = () =>
    createRootTransactionRunner({
      storage,
      lock,
      migrations,
      validator: schemaValidator,
      maintenance: maintenancePolicy,
      now: () => NOW,
      initialRoot: createInitialRoot,
    });
  return {
    createRunner,
    getStored: () => structuredClone(stored),
    getWrites: () => writes,
  };
};

const write = (expectedRevision, maintenance) => ({
  expectedRevision,
  ...(maintenance === undefined ? {} : { maintenance }),
  async execute({ snapshot }) {
    return {
      ok: true,
      value: { root: { ...snapshot, projects: [] }, value: "written" },
    };
  },
});

test("同時acquireはlock内の最新rootへ適用され一件だけ成功する", async () => {
  const harness = createSharedHarness();
  const runner = harness.createRunner();
  const [first, second] = await Promise.all([
    runner.runMaintenance({
      type: "acquire",
      ownerId: OWNER_A,
      leaseMs: 60_000,
    }),
    runner.runMaintenance({
      type: "acquire",
      ownerId: OWNER_B,
      leaseMs: 60_000,
    }),
  ]);

  assert.equal([first, second].filter((result) => result.ok).length, 1);
  assert.equal(
    [first, second].find((result) => !result.ok).error.code,
    "maintenance-active",
  );
  assert.equal(harness.getWrites(), 1);
  assert.equal(harness.getStored().maintenance.active, true);
  assert.equal(harness.getStored().revision, 1);
});

test("再生成したrunnerも永続fenceを認可根拠にしstale writeを保存前拒否する", async () => {
  const harness = createSharedHarness();
  const acquired = await harness.createRunner().runMaintenance({
    type: "acquire",
    ownerId: OWNER_A,
    leaseMs: 60_000,
  });
  assert.equal(acquired.ok, true);
  const fence = acquired.value.fence;
  const recreated = harness.createRunner();
  const before = harness.getStored();

  for (const maintenance of [
    undefined,
    { ...fence, generation: fence.generation + 1 },
    { ...fence, ownerId: OWNER_B },
    { ...fence, revision: fence.revision - 1 },
  ]) {
    const result = await recreated.run(write(1, maintenance));
    assert.equal(result.ok, false);
    assert.equal(
      result.error.code,
      maintenance === undefined ? "maintenance-active" : "stale-fence",
    );
    assert.deepEqual(harness.getStored(), before);
  }

  assert.deepEqual(await recreated.run(write(1, fence)), {
    ok: true,
    value: "written",
  });
});

for (const type of ["release", "abort"]) {
  test(`${type}後はownerなしwriteを再開できる`, async () => {
    const harness = createSharedHarness();
    const runner = harness.createRunner();
    const acquired = await runner.runMaintenance({
      type: "acquire",
      ownerId: OWNER_A,
      leaseMs: 60_000,
    });
    const finished = await harness
      .createRunner()
      .runMaintenance({ type, fence: acquired.value.fence });

    assert.deepEqual(finished, { ok: true, value: {} });
    assert.equal(harness.getStored().maintenance.active, false);
    assert.deepEqual(await runner.run(write(2)), {
      ok: true,
      value: "written",
    });
  });
}
