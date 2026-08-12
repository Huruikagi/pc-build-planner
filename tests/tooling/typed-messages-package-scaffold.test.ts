import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageDirectory = new URL(
  "../../packages/typed-messages-core/",
  import.meta.url,
);

test("typed messages core is a private dependency-free workspace package", async () => {
  const workspace = await readFile(
    new URL("../../pnpm-workspace.yaml", import.meta.url),
    "utf8",
  );
  const manifest = JSON.parse(
    await readFile(new URL("package.json", packageDirectory), "utf8"),
  ) as unknown;

  assert.match(workspace, /^packages:\s*\n\s+- ["']packages\/\*["']/m);
  assert.deepEqual(manifest, {
    name: "@pc-build-planner/typed-messages-core",
    version: "0.0.0",
    private: true,
    type: "module",
    scripts: {
      build: "tsc -p tsconfig.json",
      typecheck: "tsc --noEmit -p tsconfig.json",
      test: "node --import tsx --test tests/**/*.test.ts",
    },
    devDependencies: {
      "@types/node": "26.1.1",
      tsx: "4.23.1",
      typescript: "7.0.2",
    },
  });
});

test("typed messages core uses an isolated strict NodeNext ESM project", async () => {
  const config = JSON.parse(
    await readFile(new URL("tsconfig.json", packageDirectory), "utf8"),
  ) as {
    compilerOptions?: Record<string, unknown>;
    include?: unknown;
  };

  assert.deepEqual(config.compilerOptions, {
    declaration: true,
    exactOptionalPropertyTypes: true,
    forceConsistentCasingInFileNames: true,
    lib: ["ES2024"],
    module: "NodeNext",
    moduleResolution: "NodeNext",
    noFallthroughCasesInSwitch: true,
    noImplicitOverride: true,
    noUncheckedIndexedAccess: true,
    outDir: "dist",
    rootDir: ".",
    strict: true,
    target: "ES2024",
    types: ["node"],
  });
  assert.deepEqual(config.include, ["src/**/*.ts", "tests/**/*.ts"]);
});
