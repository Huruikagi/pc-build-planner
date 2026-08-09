import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { pathToFileURL } from "node:url";

test("開発基盤が共通検証と未パッケージbuild契約を公開する", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));

  assert.deepEqual(packageJson.engines, { node: "26.5.0", pnpm: "11.13.1" });
  assert.equal(packageJson.packageManager, "pnpm@11.13.1");
  assert.match(
    packageJson.scripts["validate:ci"],
    /typecheck.*lint.*validate:final-build.*test/,
  );
  assert.doesNotMatch(packageJson.scripts["validate:ci"], /playwright test/);
  assert.equal(
    packageJson.scripts.validate,
    "pnpm validate:ci && playwright test",
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

/**
 * `side-panel.css` は各featureのstylesheetを`@import`で束ねる唯一のentryなので、
 * import漏れはbuildもlintも素通りし、無styleのまま出荷される。
 * feature側でstyles.cssを追加した時点でこのtestが落ちるようにしておく。
 */
test("buildが全featureのstylesheetをside panel bundleへ取り込む", async () => {
  const features = await readdir("src/features", { withFileTypes: true });
  const bundled = await readFile("dist/styles.css", "utf8");

  let checked = 0;
  for (const feature of features) {
    if (!feature.isDirectory()) continue;
    const source = `src/features/${feature.name}/styles.css`;
    let stylesheet: string;
    try {
      stylesheet = await readFile(source, "utf8");
    } catch {
      continue;
    }
    const firstSelector = /^\s*(\.[\w-]+)/m.exec(stylesheet)?.[1];
    assert.ok(firstSelector, `${source} にclass selectorが見つからない`);
    assert.ok(
      bundled.includes(firstSelector),
      `${source} が dist/styles.css へ束ねられていない (src/application-shell/side-panel.css の @import 漏れ)`,
    );
    checked += 1;
  }
  assert.ok(checked > 0, "feature stylesheetが一件も検査されていない");
});

test("buildがroot公開bundleと共有service workerを生成する", async () => {
  await access("dist/index.js");
  await access("dist/service-worker.js");
  const rootBundle = await readFile("dist/index.js", "utf8");
  assert.doesNotMatch(rootBundle, /createCompositionRoot/);
  const artifactUrl = pathToFileURL("dist/index.js");
  artifactUrl.searchParams.set("test", `${Date.now()}-${Math.random()}`);
  const artifact = (await import(artifactUrl.href)) as {
    readonly composeApplicationApi: (
      context: unknown,
      dependencies: unknown,
    ) => {
      readonly ok: boolean;
      readonly value?: object;
    };
  };
  const data = {
    query: async () => ({ ok: true, value: 0 }),
    mutate: async () => ({ ok: true, value: {} }),
    assessReplacement: async () => ({ ok: true, value: {} }),
    replaceRoot: async () => ({ ok: true, value: {} }),
    runMaintenance: async () => ({ ok: true, value: {} }),
  };
  const composed = artifact.composeApplicationApi(
    {
      data,
      navigator: { activate: async () => ({ ok: true, value: undefined }) },
    },
    { backupRestoreData: data },
  );
  assert.equal(composed.ok, true);
  assert.ok(composed.value);
  assert.deepEqual(Object.keys(composed.value), [
    "candidateManagement",
    "currentBuild",
    "compatibility",
    "settings",
    "productCapture",
    "sourcePriceRefresh",
  ]);
  assert.equal(Object.getPrototypeOf(composed.value), null);
  assert.equal(Object.isFrozen(composed.value), true);
});

test("production worker artifactはmenu registrationだけを取り込みUIとページ値を持たない", async () => {
  const worker = await readFile("dist/service-worker.js", "utf8");

  assert.match(
    worker,
    /src\/features\/source-price-refresh\/context-menu-source\.ts/,
    "feature所有のmenu adapterをproduction bundleで実際に使う",
  );
  assert.match(worker, /source-price-refresh/);
  assert.doesNotMatch(
    worker,
    /src\/application-shell\/side-panel-contributions\.ts|src\/features\/source-price-refresh\/(?:feature-contribution|registration|react-root|view)\.[tj]sx?/,
  );
  assert.doesNotMatch(worker, /node_modules[\\/](?:react|react-dom)[\\/]/);
  assert.doesNotMatch(
    worker,
    /src\/features\/product-capture\/manufacturer-domain-map\.ts/,
    "worker metadataのために商品解析catalogを取り込まない",
  );
  // Fail-closed allowlist: every absolute URL the worker bundle may contain is
  // enumerated, so a newly pinned site URL — first-party or vendored — fails
  // here instead of shipping.
  const allowedWorkerUrls = new Set([
    // Context menu patterns address every page, never one site.
    "http://*/*",
    "https://*/*",
    // Runtime schema vendor: JSON Schema dialect identifiers and its own
    // URL-parser probes. Neither addresses a real site.
    "http://json-schema.org/draft-04/schema#",
    "http://json-schema.org/draft-07/schema#",
    "https://json-schema.org/draft/2020-12/schema",
    `http://[\${address}]`,
    `http://[\${payload.value}]`,
  ]);
  const workerUrls = new Set(worker.match(/https?:\/\/[^"'`\s)\\]*/g) ?? []);

  assert.deepEqual(
    [...workerUrls].filter((url) => !allowedWorkerUrls.has(url)),
    [],
    "documentUrlPatternsのワイルドカード以外の完全URLをworkerに固定しない",
  );
});
