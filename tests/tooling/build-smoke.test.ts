import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { pathToFileURL } from "node:url";

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

test("buildがside panel runtime fixtureを生成する", async () => {
  await access("dist/side-panel.html");
  await access("dist/side-panel.js");
  assert.match(
    await readFile("dist/side-panel.html", "utf8"),
    /src=["']\.\/side-panel\.js["']/,
  );
});

test("buildがroot公開bundleと共有service workerを生成する", async () => {
  await access("dist/index.js");
  await access("dist/service-worker.js");
  const rootBundle = await readFile("dist/index.js", "utf8");
  assert.doesNotMatch(rootBundle, /createCompositionRoot/);
  const artifactUrl = pathToFileURL("dist/index.js");
  artifactUrl.searchParams.set("test", `${Date.now()}-${Math.random()}`);
  const artifact = (await import(artifactUrl.href)) as {
    readonly applicationApi: object;
  };
  assert.deepEqual(Object.keys(artifact.applicationApi), []);
  assert.equal(Object.getPrototypeOf(artifact.applicationApi), null);
  assert.equal(Object.isFrozen(artifact.applicationApi), true);
});
