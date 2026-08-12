import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  runValidationGates,
  typedMessagesCoreValidationGates,
} from "../../scripts/validate-typed-messages-core.mjs";

test("core validation owns only package, read-only consumer, and package boundary gates", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };

  assert.deepEqual(typedMessagesCoreValidationGates, [
    ["pnpm", "--filter", "@pc-build-planner/typed-messages-core", "validate"],
    ["pnpm", "typecheck:typed-messages-consumer"],
    ["pnpm", "validate:typed-messages-boundaries"],
  ]);
  assert.equal(
    manifest.scripts["validate:typed-messages-core"],
    "node scripts/validate-typed-messages-core.mjs",
  );
  assert.equal(
    manifest.scripts["typecheck:typed-messages-consumer"],
    "tsc --noEmit -p tsconfig.typed-messages-consumer.json",
  );
  assert.equal(
    manifest.scripts["validate:typed-messages-boundaries"],
    "node scripts/validate-boundaries.mjs packages/typed-messages-core/src tests/tooling/typed-messages-consumer.ts",
  );

  const coreValidation = manifest.scripts["validate:typed-messages-core"];
  assert.doesNotMatch(
    coreValidation,
    /ui-text|runtime-schema|fixture|final-build|catalog|release|playwright/,
  );
  const validateCi = manifest.scripts["validate:ci"];
  assert.ok(validateCi);
  assert.ok(validateCi.startsWith("pnpm validate:typed-messages-core && "));
});

test("core validation stops at the first failed gate and preserves its exit status", () => {
  const calls: string[][] = [];
  const status = runValidationGates(
    typedMessagesCoreValidationGates,
    (command, args) => {
      calls.push([command, ...args]);
      return { status: calls.length === 2 ? 23 : 0 };
    },
  );

  assert.equal(status, 23);
  assert.deepEqual(calls, typedMessagesCoreValidationGates.slice(0, 2));
});
