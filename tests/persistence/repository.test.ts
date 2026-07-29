// @ts-nocheck Repository境界へ意図的な旧schemaと破損値を渡す。
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import { schemaValidator } from "../../src/domain/validation.ts";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import {
  createInMemoryStorageAdapter,
  createInMemoryStorageState,
} from "../../src/persistence/in-memory-storage-adapter.ts";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import { createMigrationRegistry } from "../../src/persistence/migration-registry.ts";

// productionのNodeNext `.js` importを、source直接実行時だけ対応する`.ts`へ解決する。
registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(
      specifier.endsWith("/schema.js")
        ? `${specifier.slice(0, -3)}.ts`
        : specifier,
      context,
    );
  },
});

// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
const { createLocalDataRepository } = await import(
  "../../src/persistence/repository.ts"
);

const currentRoot = (revision = 0) => ({
  schemaVersion: 1,
  revision,
  projects: [],
  candidateParts: [],
  currentBuilds: [],
  requestDedupe: [],
  maintenance: { generation: 0, active: false },
});

const repositoryFor = (state, steps = []) =>
  createLocalDataRepository(
    createInMemoryStorageAdapter(state),
    createMigrationRegistry(1, steps, schemaValidator),
  );

test("未保存時は現行版の初期rootを返す", async () => {
  const result = await repositoryFor(createInMemoryStorageState()).readRoot();
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, currentRoot());
});

test("保存rootを検証し、Repository再生成後も同じsnapshotを読む", async () => {
  const state = createInMemoryStorageState();
  state.entries.set("localDataRoot", currentRoot(7));
  const first = await repositoryFor(state).readRoot();
  const recreated = await repositoryFor(state).readRoot();
  assert.equal(first.ok, true);
  assert.equal(recreated.ok, true);
  assert.deepEqual(recreated.value, first.value);
});

test("canonical複数sourceを読み、旧開発shapeはsourceを書き換えず拒否する", async () => {
  const canonical = currentRoot(3);
  canonical.projects.push({
    id: "11111111-1111-4111-8111-111111111111",
    name: "架空構成",
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
  });
  canonical.candidateParts.push({
    id: "22222222-2222-4222-8222-222222222222",
    projectId: canonical.projects[0].id,
    category: "cpu",
    product: { name: { original: "架空CPU" } },
    sources: [],
    normalizedAttributes: { category: "cpu" },
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
  });
  const validState = createInMemoryStorageState();
  validState.entries.set("localDataRoot", canonical);
  assert.equal((await repositoryFor(validState).readRoot()).ok, true);

  for (const legacyCandidate of [
    { ...canonical.candidateParts[0], sourceInfo: {} },
    {
      ...canonical.candidateParts[0],
      product: { name: { original: "架空CPU" }, price: { original: "100" } },
    },
  ]) {
    const legacy = { ...canonical, candidateParts: [legacyCandidate] };
    const state = createInMemoryStorageState();
    state.entries.set("localDataRoot", structuredClone(legacy));
    const result = await repositoryFor(state).readRoot();
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "corrupt-data");
    assert.deepEqual(state.entries.get("localDataRoot"), legacy);
  }
});

test("queryへはmigrationと全体validation済みsnapshotだけを渡す", async () => {
  const state = createInMemoryStorageState();
  state.entries.set("localDataRoot", { schemaVersion: 0, legacyRevision: 4 });
  const repository = repositoryFor(state, [
    {
      from: 0,
      to: 1,
      migrate: (input) => ({
        ok: true,
        value: currentRoot(input.legacyRevision),
      }),
    },
  ]);
  const result = await repository.query((snapshot) => snapshot.revision);
  assert.deepEqual(result, { ok: true, value: 4 });
  assert.deepEqual(state.entries.get("localDataRoot"), {
    schemaVersion: 0,
    legacyRevision: 4,
  });
});

test("破損・未来版・移行失敗はtyped failureでsourceを上書きしない", async () => {
  const cases = [
    [currentRoot(-1), [], "corrupt-data"],
    [{ schemaVersion: 2 }, [], "unsupported-version"],
    [
      { schemaVersion: 0 },
      [
        {
          from: 0,
          to: 1,
          migrate: () => ({ ok: false, error: { code: "migration-failed" } }),
        },
      ],
      "migration-failed",
    ],
  ];
  for (const [source, steps, code] of cases) {
    const state = createInMemoryStorageState();
    state.entries.set("localDataRoot", structuredClone(source));
    const before = structuredClone(source);
    const result = await repositoryFor(state, steps).readRoot();
    assert.equal(result.ok, false);
    assert.equal(result.error.code, code);
    assert.deepEqual(state.entries.get("localDataRoot"), before);
  }
});

test("storage read failureを公開しquery callbackを呼ばない", async () => {
  const state = createInMemoryStorageState();
  state.failNext("read");
  let called = false;
  const result = await repositoryFor(state).query(() => {
    called = true;
    return 1;
  });
  assert.deepEqual(result, {
    ok: false,
    error: { code: "storage-unavailable" },
  });
  assert.equal(called, false);
});
