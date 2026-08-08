import assert from "node:assert/strict";
import test from "node:test";
import { schemaValidator } from "../../src/domain/validation.js";
import {
  createInMemoryStorageAdapter,
  createInMemoryStorageState,
} from "../../src/persistence/in-memory-storage-adapter.js";
import { createMigrationRegistry } from "../../src/persistence/migration-registry.js";
import { createRecoveryCoordinator } from "../../src/persistence/recovery.js";
import { createReplacementCoordinator } from "../../src/persistence/replacement.js";

const coordinatorFor = (raw: unknown) => {
  const state = createInMemoryStorageState({ quotaBytes: 100_000 });
  state.entries.set("localDataRoot", raw);
  const storage = createInMemoryStorageAdapter(state);
  const migrations = createMigrationRegistry(1, [], schemaValidator);
  return createRecoveryCoordinator(
    storage,
    migrations,
    createReplacementCoordinator(migrations, schemaValidator),
  );
};

const validCandidate = {
  schemaVersion: 1,
  revision: 0,
  projects: [],
  candidateParts: [],
  currentBuilds: [],
  requestDedupe: [],
  maintenance: { generation: 0, active: false },
};

test("破損rootはraw値を公開せず安定fingerprint付きで分類し、評価は保存値を変えない", async () => {
  const raw = { schemaVersion: 1, revision: "broken" };
  const coordinator = coordinatorFor(raw);
  const first = await coordinator.assessRecovery(validCandidate);
  const second = await coordinator.assessRecovery(validCandidate);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.deepEqual(first.value.cursor.current, second.value.cursor.current);
  assert.equal(first.value.cursor.current.code, "corrupt-data");
  assert.equal(JSON.stringify(first.value).includes("broken"), false);
});

test("未対応schemaはversionだけを安全に分類し、候補不正はcurrent anomalyと別fieldで返す", async () => {
  const coordinator = coordinatorFor({
    schemaVersion: 99,
    opaque: "synthetic",
  });
  const result = await coordinator.assessRecovery({ schemaVersion: 1 });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "recovery-candidate-rejected");
  if (result.error.code !== "recovery-candidate-rejected") return;
  assert.deepEqual(result.error.current.code, "unsupported-version");
  assert.equal(result.error.current.version, 99);
  assert.notEqual(result.error.candidate.code, "unsupported-version");
});
