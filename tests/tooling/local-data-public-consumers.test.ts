import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  localDataPublicConsumerGates,
  runLocalDataPublicConsumerGates,
} from "../../scripts/validate-local-data-public-consumers.mjs";

test("local data public consumers validate clean built entries in order", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };

  assert.deepEqual(localDataPublicConsumerGates, [
    ["pnpm", "clean:local-data"],
    ["pnpm", "--filter", "@pc-build-planner/local-data", "build"],
    ["pnpm", "typecheck:local-data-public-declarations"],
    ["pnpm", "typecheck:local-data-public-consumers"],
    ["node", "scripts/validate-local-data-transaction-public-contract.mjs"],
    [
      "node",
      "--import",
      "tsx",
      "tests/tooling/local-data-replacement-backup-runtime-contract.ts",
    ],
    ["node", "--import", "tsx", "tests/tooling/local-data-core-consumer.ts"],
    ["node", "--import", "tsx", "tests/tooling/local-data-chrome-consumer.ts"],
    ["node", "--import", "tsx", "tests/tooling/local-data-backup-consumer.ts"],
    ["node", "tests/tooling/local-data-undeclared-consumer.mjs"],
  ]);
  assert.equal(
    manifest.scripts["validate:local-data-public-consumers"],
    "node scripts/validate-local-data-public-consumers.mjs",
  );
  assert.equal(
    manifest.scripts["typecheck:local-data-public-declarations"],
    "tsc --noEmit -p tsconfig.local-data-public-declarations.json",
  );
  assert.equal(
    manifest.scripts["typecheck:local-data-public-consumers"],
    "tsc --noEmit -p tsconfig.local-data-public-consumers.json",
  );
});

test("local data public consumer validation stops at the first failed gate", () => {
  const calls: string[][] = [];
  const status = runLocalDataPublicConsumerGates(
    localDataPublicConsumerGates,
    (command, args) => {
      calls.push([command, ...args]);
      return { status: calls.length === 3 ? 19 : 0 };
    },
  );

  assert.equal(status, 19);
  assert.deepEqual(calls, localDataPublicConsumerGates.slice(0, 3));
});

test("undeclared local data subpath is rejected by runtime resolution", async () => {
  const undeclaredSubpath = "@pc-build-planner/local-data/undeclared";
  await assert.rejects(
    import(undeclaredSubpath),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED",
  );
});
