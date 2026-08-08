// @ts-nocheck 保存境界へ意図的に旧schemaと生の交換形式値を渡す。
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import { schemaValidator } from "../../src/domain/validation.ts";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import { mapBackupEnvelopeToRoot } from "../../src/features/backup-restore/exchange.ts";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import { createMigrationRegistry } from "../../src/persistence/migration-registry.ts";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import { CURRENT_SCHEMA_VERSION as publicSchemaVersion } from "../../src/persistence/public.ts";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import { createReplacementCoordinator } from "../../src/persistence/replacement.ts";
// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import {
  CURRENT_SCHEMA_VERSION,
  createInitialRoot,
} from "../../src/persistence/schema.ts";

const backupEnvelope = () => ({
  product: "pc-build-planner",
  formatVersion: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  data: { projects: [], parts: [], currentBuilds: [] },
});

const evaluation = {
  currentBytes: 64,
  quotaBytes: 10_485_760,
  revision: 3,
  maintenance: { generation: 0, active: false },
};

test("公開入口がSchemaContract所有の正規値をそのまま公開する", () => {
  assert.equal(publicSchemaVersion, CURRENT_SCHEMA_VERSION);
});

test("初期rootとmigrationの現行版が同じ正規値を参照する", () => {
  assert.equal(createInitialRoot().schemaVersion, CURRENT_SCHEMA_VERSION);

  const migrations = createMigrationRegistry(
    CURRENT_SCHEMA_VERSION,
    [],
    schemaValidator,
  );
  assert.equal(migrations.toCurrent(createInitialRoot()).ok, true);

  const future = migrations.toCurrent({
    ...createInitialRoot(),
    schemaVersion: CURRENT_SCHEMA_VERSION + 1,
  });
  assert.equal(future.ok, false);
  assert.equal(future.error.code, "unsupported-version");
});

test("置換評価のtarget schema versionが同じ正規値になる", async () => {
  const coordinator = createReplacementCoordinator(
    createMigrationRegistry(CURRENT_SCHEMA_VERSION, [], schemaValidator),
    schemaValidator,
  );
  const assessment = await coordinator.assessReplacement(
    createInitialRoot(),
    evaluation,
  );
  assert.equal(assessment.ok, true);
  assert.equal(assessment.value.targetSchemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(
    assessment.value.cursor.targetSchemaVersion,
    CURRENT_SCHEMA_VERSION,
  );
});

test("交換形式向け写像が同じ正規値のrootを構築する", () => {
  const mapped = mapBackupEnvelopeToRoot(backupEnvelope());
  assert.equal(mapped.ok, true);
  assert.equal(mapped.value.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(schemaValidator.validateRoot(mapped.value).ok, true);
});

const SCHEMA_VERSION_DECLARATION =
  /(?:^|\n)\s*(?:export\s+)?const\s+[A-Za-z0-9_]*SCHEMA_VERSION\s*(?::[^=]+)?=\s*\d/g;
const CANONICAL_SCHEMA_MODULE = "persistence/schema.ts";

const sourceFiles = async (root: URL): Promise<URL[]> => {
  const files: URL[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const child = new URL(
      entry.isDirectory() ? `${entry.name}/` : entry.name,
      root,
    );
    if (entry.isDirectory()) files.push(...(await sourceFiles(child)));
    else if (/\.tsx?$/.test(entry.name)) files.push(child);
  }
  return files;
};

test("保存schema versionの数値をschema.ts以外のmoduleで定義しない", async () => {
  const root = new URL("../../src/", import.meta.url);
  const declaring: string[] = [];
  for (const file of await sourceFiles(root)) {
    const source = await readFile(file, "utf8");
    SCHEMA_VERSION_DECLARATION.lastIndex = 0;
    if (SCHEMA_VERSION_DECLARATION.test(source))
      declaring.push(file.href.slice(root.href.length));
  }
  assert.deepEqual(declaring, [CANONICAL_SCHEMA_MODULE]);
});
