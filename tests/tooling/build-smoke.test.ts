import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("開発基盤が共通検証と未パッケージbuild契約を公開する", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));

  assert.deepEqual(packageJson.engines, { node: "26.5.0", pnpm: "11.13.1" });
  assert.equal(packageJson.packageManager, "pnpm@11.13.1");
  assert.match(
    packageJson.scripts.validate,
    /typecheck.*lint.*validate:final-build.*test.*playwright test/,
  );
  assert.equal(
    packageJson.scripts["install:e2e-browser"],
    "playwright install chromium",
  );

  await access("tsconfig.json");
  await access("biome.json");
  await access("scripts/build.mjs");
  await access("src/build-contract.ts");
  await access("src/persistence/public.ts");
});

test("buildが検査対象となるfoundation公開bundleを生成する", async () => {
  await access("dist/foundation.js");
  assert.match(
    await readFile("dist/foundation.js", "utf8"),
    /createDataWorkerRegistration/,
  );
});
