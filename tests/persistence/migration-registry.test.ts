// @ts-nocheck migration境界へ意図的な旧schemaと破損値を渡す。
import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import { schemaValidator } from "../../src/domain/validation.ts";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import { createMigrationRegistry } from "../../src/persistence/migration-registry.ts";

const currentRoot = () => ({
  schemaVersion: 1,
  revision: 0,
  projects: [],
  candidateParts: [],
  currentBuilds: [],
  requestDedupe: [],
  maintenance: { generation: 0, active: false },
});

test("N→N+1 stepを順序適用し、各出力と最終rootを検証する", () => {
  const calls = [];
  const registry = createMigrationRegistry(
    1,
    [
      {
        from: -1,
        to: 0,
        migrate: (input) => {
          calls.push([-1, 0]);
          return {
            ok: true,
            value: { ...input, schemaVersion: 0, projects: [] },
          };
        },
      },
      {
        from: 0,
        to: 1,
        migrate: (input) => {
          calls.push([0, 1]);
          return {
            ok: true,
            value: { ...currentRoot(), projects: input.projects },
          };
        },
      },
    ],
    schemaValidator,
  );
  const source = { schemaVersion: -1, legacy: true };
  const before = structuredClone(source);
  const result = registry.toCurrent(source);
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    [-1, 0],
    [0, 1],
  ]);
  assert.deepEqual(source, before);
  assert.equal(result.value.schemaVersion, 1);
});

test("将来版と経路欠落を別codeで拒否し、非連続step登録を拒否する", () => {
  const future = createMigrationRegistry(1, [], schemaValidator).toCurrent({
    schemaVersion: 2,
  });
  assert.equal(future.ok, false);
  assert.equal(future.error.code, "unsupported-version");
  const missing = createMigrationRegistry(1, [], schemaValidator).toCurrent({
    schemaVersion: 0,
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "migration-path-missing");
  assert.throws(() =>
    createMigrationRegistry(
      2,
      [{ from: 0, to: 2, migrate: () => ({ ok: true, value: {} }) }],
      schemaValidator,
    ),
  );
});

test("step失敗とstep出力検証失敗を区別しsourceを変更しない", () => {
  const source = { schemaVersion: 0, nested: { stable: true } };
  const before = structuredClone(source);
  const failed = createMigrationRegistry(
    1,
    [
      {
        from: 0,
        to: 1,
        migrate: () => ({ ok: false, error: { code: "migration-failed" } }),
      },
    ],
    schemaValidator,
  ).toCurrent(source);
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, "migration-failed");
  assert.deepEqual(source, before);
  const invalid = createMigrationRegistry(
    1,
    [
      {
        from: 0,
        to: 1,
        migrate: () => ({ ok: true, value: { schemaVersion: 1 } }),
      },
    ],
    schemaValidator,
  ).toCurrent(source);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, "validation");
  assert.deepEqual(source, before);
});

test("現行rootも最終検証し、schemaVersion不明値をfail closedする", () => {
  assert.equal(
    createMigrationRegistry(1, [], schemaValidator).toCurrent(currentRoot()).ok,
    true,
  );
  for (const source of [
    null,
    {},
    { schemaVersion: "1" },
    { schemaVersion: 1.5 },
  ]) {
    const result = createMigrationRegistry(1, [], schemaValidator).toCurrent(
      source,
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation");
  }
});
