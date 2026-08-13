import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  findProductDeclarationLeak,
  localDataReadOnlyAppContractGates,
  runLocalDataReadOnlyAppContractGates,
  validateNegativeCapabilityDiagnostics,
} from "../../scripts/validate-local-data-read-only-app-contract.mjs";

const negativeFixture = `import type { BackupOrchestrator } from "@pc-build-planner/local-data/backup";
declare const backup: BackupOrchestrator<unknown, unknown, unknown, unknown, unknown>;
backup.query;
backup.mutate;
`;

test("read-only app contract validates built declarations and negative capabilities", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };

  assert.deepEqual(localDataReadOnlyAppContractGates, [
    ["pnpm", "clean:local-data"],
    ["pnpm", "--filter", "@pc-build-planner/local-data", "build"],
    ["pnpm", "typecheck:local-data-read-only-app-contract"],
  ]);
  assert.equal(
    manifest.scripts["validate:local-data-read-only-app-contract"],
    "node scripts/validate-local-data-read-only-app-contract.mjs",
  );
});

test("negative capability diagnostics require TS2339 at the exact fixture line", () => {
  const diagnostics = [
    "tests/tooling/local-data-read-only-app-contract-negative.mts(3,8): error TS2339: Property 'query' does not exist on type 'BackupOrchestrator'.",
    "other.ts(4,8): error TS2339: Property 'mutate' does not exist on type 'Other'.",
  ].join("\n");

  assert.equal(
    validateNegativeCapabilityDiagnostics(
      { status: 2, stdout: diagnostics, stderr: "" },
      negativeFixture,
      ["query", "mutate"],
    ),
    false,
  );
});

test("negative capability diagnostics reject an allowed forbidden property", () => {
  const diagnostics =
    "tests/tooling/local-data-read-only-app-contract-negative.mts(4,8): error TS2339: Property 'mutate' does not exist on type 'BackupOrchestrator'.";

  assert.equal(
    validateNegativeCapabilityDiagnostics(
      { status: 2, stdout: diagnostics, stderr: "" },
      negativeFixture,
      ["query", "mutate"],
    ),
    false,
  );
});

test("negative capability diagnostics reject unexpected compiler errors", () => {
  const diagnostics = [
    "tests/tooling/local-data-read-only-app-contract-negative.mts(3,8): error TS2339: Property 'query' does not exist on type 'BackupOrchestrator'.",
    "tests/tooling/local-data-read-only-app-contract-negative.mts(4,8): error TS2339: Property 'mutate' does not exist on type 'BackupOrchestrator'.",
    "tests/tooling/local-data-read-only-app-contract-negative.mts(4,1): error TS2322: Type 'string' is not assignable to type 'number'.",
  ].join("\n");

  assert.equal(
    validateNegativeCapabilityDiagnostics(
      { status: 2, stdout: diagnostics, stderr: "" },
      negativeFixture,
      ["query", "mutate"],
    ),
    false,
  );
});

test("product-owned input names and paths are rejected from declarations", () => {
  const markers = [
    "LocalDataRoot",
    "FoundationError",
    "MaintenanceState",
    "RootOperation",
    "BackupArtifact",
    "BackupDataV1",
    "CurrentBackupEnvelope",
    "RestoreInput",
    "RestorePreview",
    "RestoreSummary",
    "src/domain/public.js",
    "src/features/backup-restore/contracts.js",
    "src/persistence/public.js",
  ];

  for (const marker of markers) {
    const declaration = marker.includes("/")
      ? `import type { Leaked } from ${JSON.stringify(`../../${marker}`)};`
      : `import type { ${marker} } from "../../product.js";`;
    assert.equal(findProductDeclarationLeak(declaration), marker, marker);
  }

  assert.equal(
    findProductDeclarationLeak(
      "export interface BackupArtifactPolicy<RestoreInput> {}",
    ),
    undefined,
  );
});

test("read-only app contract stops before negative checks after a positive gate failure", async () => {
  const calls: string[][] = [];
  const status = await runLocalDataReadOnlyAppContractGates(
    localDataReadOnlyAppContractGates,
    async (command, args) => {
      calls.push([command, ...args]);
      return { status: calls.length === 2 ? 23 : 0, stdout: "", stderr: "" };
    },
  );

  assert.equal(status, 23);
  assert.deepEqual(calls, localDataReadOnlyAppContractGates.slice(0, 2));
});
