import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const packageRoot = new URL("../", import.meta.url);

test("package scaffold declares exactly three private public entries", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("package.json", packageRoot), "utf8"),
  ) as Record<string, unknown>;

  assert.equal(manifest.private, true);
  assert.equal(manifest.type, "module");
  assert.equal("dependencies" in manifest, false);
  assert.equal("peerDependencies" in manifest, false);
  assert.equal("publishConfig" in manifest, false);
  assert.deepEqual(manifest.exports, {
    ".": {
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
    },
    "./chrome": {
      types: "./dist/chrome/index.d.ts",
      import: "./dist/chrome/index.js",
    },
    "./backup": {
      types: "./dist/backup/index.d.ts",
      import: "./dist/backup/index.js",
    },
  });
  assert.deepEqual(manifest.scripts, {
    clean:
      'node --eval "require(\'node:fs\').rmSync(\'dist\', { recursive: true, force: true })"',
    build: "tsc -p tsconfig.build.json",
    typecheck: "tsc --noEmit -p tsconfig.json",
    "test:core": "node --import tsx --test tests/*.test.ts",
    "test:chrome": "node --import tsx --test tests/chrome/*.test.ts",
    "test:backup": "node --import tsx --test tests/backup/*.test.ts",
    "test:unit": "node --import tsx --test tests/**/*.test.ts",
    test: "pnpm run build && pnpm run test:unit",
    validate:
      "pnpm run clean && pnpm run build && pnpm run typecheck && pnpm run test",
  });
});

test("TypeScript compilation is strict NodeNext ESM", async () => {
  const config = JSON.parse(
    await readFile(new URL("tsconfig.json", packageRoot), "utf8"),
  ) as { compilerOptions?: Record<string, unknown> };

  assert.equal(config.compilerOptions?.strict, true);
  assert.equal(config.compilerOptions?.module, "NodeNext");
  assert.equal(config.compilerOptions?.moduleResolution, "NodeNext");
  assert.equal(config.compilerOptions?.target, "ES2024");
});

test("clean build emits JavaScript and declarations for every public entry", async () => {
  for (const output of [
    "dist/index.js",
    "dist/index.d.ts",
    "dist/chrome/index.js",
    "dist/chrome/index.d.ts",
    "dist/backup/index.js",
    "dist/backup/index.d.ts",
  ]) {
    await access(new URL(output, packageRoot));
  }
});
