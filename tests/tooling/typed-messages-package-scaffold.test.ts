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
  ) as {
    name?: unknown;
    private?: unknown;
    type?: unknown;
    exports?: unknown;
    scripts?: Record<string, unknown>;
    dependencies?: unknown;
    devDependencies?: unknown;
  };

  assert.match(workspace, /^packages:\s*\n\s+- ["']packages\/\*["']/m);
  assert.equal(manifest.name, "@pc-build-planner/typed-messages-core");
  assert.equal(manifest.private, true);
  assert.equal(manifest.type, "module");
  assert.equal(manifest.dependencies, undefined);
  assert.deepEqual(manifest.devDependencies, {
    "@types/node": "26.1.1",
    tsx: "4.23.1",
    typescript: "7.0.2",
  });
  assert.deepEqual(manifest.exports, {
    ".": {
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
    },
  });
  assert.equal(
    manifest.scripts?.clean,
    "node --eval \"require('node:fs').rmSync('dist', { recursive: true, force: true })\"",
  );
  assert.equal(manifest.scripts?.build, "tsc -p tsconfig.build.json");
  assert.equal(manifest.scripts?.typecheck, "tsc --noEmit -p tsconfig.json");
  assert.equal(manifest.scripts?.test, "pnpm run build && pnpm run test:unit");
  assert.equal(
    manifest.scripts?.["test:unit"],
    "node --import tsx --test tests/**/*.test.ts",
  );
  assert.equal(
    manifest.scripts?.validate,
    "pnpm run clean && pnpm run build && pnpm run typecheck && pnpm run test",
  );
});

test("typed messages core uses an isolated strict NodeNext ESM project", async () => {
  const config = JSON.parse(
    await readFile(new URL("tsconfig.json", packageDirectory), "utf8"),
  ) as {
    compilerOptions?: Record<string, unknown>;
    include?: unknown;
  };
  const buildConfig = JSON.parse(
    await readFile(new URL("tsconfig.build.json", packageDirectory), "utf8"),
  ) as {
    extends?: unknown;
    compilerOptions?: Record<string, unknown>;
    include?: unknown;
    exclude?: unknown;
  };

  assert.equal(config.compilerOptions?.strict, true);
  assert.equal(config.compilerOptions?.module, "NodeNext");
  assert.equal(config.compilerOptions?.moduleResolution, "NodeNext");
  assert.equal(config.compilerOptions?.declaration, true);
  assert.equal(config.compilerOptions?.rootDir, ".");
  assert.equal(config.compilerOptions?.outDir, undefined);
  assert.deepEqual(config.include, ["src/**/*.ts", "tests/**/*.ts"]);

  assert.equal(buildConfig.extends, "./tsconfig.json");
  assert.deepEqual(buildConfig.compilerOptions, {
    outDir: "dist",
    rootDir: "src",
  });
  assert.deepEqual(buildConfig.include, ["src/**/*.ts"]);
  assert.deepEqual(buildConfig.exclude, ["tests/**/*.ts"]);
});
