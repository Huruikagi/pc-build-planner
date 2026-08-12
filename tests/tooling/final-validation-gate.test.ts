import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { runFinalGate } from "../../scripts/validate-final-gate.mjs";
import {
  findFixtureAssetViolations,
  findFixtureRegistryViolations,
} from "../../scripts/validate-fixture-assets.mjs";

const runtimeSchemaGateReport = {
  dynamicFunctionCalls: 0,
  bundles: [
    { entry: "side-panel", baselineBytes: 1, currentBytes: 1, deltaBytes: 0 },
  ],
  licenseNoticePresent: true,
};

const runtimeSchemaNotice =
  "zod 4.4.3\nreact 19.2.8\nreact-dom 19.2.8\nscheduler 0.27.0\nMIT License\nPermission is hereby granted";

const validManifest = {
  manifest_version: 3,
  name: "Synthetic extension",
  version: "1.0.0",
  minimum_chrome_version: "116",
  permissions: [
    "storage",
    "activeTab",
    "scripting",
    "sidePanel",
    "contextMenus",
  ],
  action: {},
  background: { service_worker: "service-worker.js", type: "module" },
  side_panel: { default_path: "side-panel.html" },
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'",
  },
};

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "final-gate-"));
  const source = join(root, "feature.ts");
  const fixtures = join(root, "fixtures");
  const output = join(root, "dist");
  await mkdir(fixtures);
  await writeFile(source, 'import type { Result } from "../domain/public.js";');
  await writeFile(join(fixtures, "synthetic.json"), '{"name":"架空"}');
  return { source, fixtures, output };
}

const builder =
  (
    manifest: typeof validManifest & Record<string, unknown> = validManifest,
    extra: Record<string, string> = {},
  ) =>
  async (output = "") => {
    await assert.rejects(access(join(output, "stale.js")));
    await mkdir(output, { recursive: true });
    await writeFile(join(output, "manifest.json"), JSON.stringify(manifest));
    await writeFile(
      join(output, "side-panel.html"),
      '<main id="application-shell"></main><script type="module" src="./side-panel.js"></script>',
    );
    await writeFile(
      join(output, "side-panel.js"),
      "/* node_modules/react/cjs/react.production.js */ /* node_modules/react-dom/cjs/react-dom-client.production.js */ export const started=true;",
    );
    await writeFile(
      join(output, "service-worker.js"),
      "export const registered=true;",
    );
    await writeFile(
      join(output, "build-contract.js"),
      "export const ready = true;",
    );
    await writeFile(
      join(output, "foundation.js"),
      "const initializeProductionFoundationRuntimeContribution=()=>{}; export { initializeProductionFoundationRuntimeContribution };",
    );
    await writeFile(
      join(output, "runtime-schema-gate-report.json"),
      JSON.stringify(runtimeSchemaGateReport),
    );
    await writeFile(
      join(output, "THIRD_PARTY_NOTICES.txt"),
      runtimeSchemaNotice,
    );
    for (const [name, content] of Object.entries(extra))
      await writeFile(join(output, name), content);
  };

test("source検査からclean buildとartifact検査までを一つのgateで完走する", async () => {
  const paths = await workspace();
  await mkdir(paths.output);
  await writeFile(join(paths.output, "stale.js"), "eval('stale')");
  await runFinalGate({
    outputDirectory: paths.output,
    boundaryRoots: [paths.source],
    fixtureRoots: [paths.fixtures],
    build: builder(),
  });
});

test("実際のproduction bundleをfixture商品内容として誤検出しない", async () => {
  const paths = await workspace();
  await runFinalGate({
    outputDirectory: paths.output,
    boundaryRoots: [paths.source],
    fixtureRoots: [paths.fixtures],
  });
});

test("artifact fixture検査は除外対象の実行bundleを解析前に省く", async () => {
  const paths = await workspace();
  const executable = join(paths.fixtures, "large.js");
  const image = join(paths.fixtures, "photo.png");
  await writeFile(executable, `"${"x".repeat(700_000)}`);
  await writeFile(image, "synthetic bytes");

  const violations = await findFixtureAssetViolations(
    paths.fixtures,
    [],
    (path) => !/\.[cm]?js$/i.test(path),
  );

  assert.deepEqual(violations, [{ path: image, rule: "image-file" }]);
});

test("artifact fixture CLIはlicense noticeをfixtureとして検査しない", async () => {
  const paths = await workspace();
  await writeFile(
    join(paths.fixtures, "THIRD_PARTY_NOTICES.txt"),
    "Package homepage: https://example.com/package",
  );

  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/validate-fixture-assets.mjs",
      paths.fixtures,
      "--exclude-executables",
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});

test("artifact fixture CLIはlicense noticeの近似名を除外しない", async () => {
  const paths = await workspace();
  const nearMatch = join(paths.fixtures, "backup-THIRD_PARTY_NOTICES.txt");
  await writeFile(nearMatch, "Package homepage: https://example.com/package");

  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/validate-fixture-assets.mjs",
      paths.fixtures,
      "--exclude-executables",
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /non-synthetic-url/);
});

test("validate:fixtures CLIはregistryの非架空source値を拒否する", async () => {
  const paths = await workspace();
  const registry = join(paths.fixtures, "source-registry.ts");
  await writeFile(
    registry,
    "export const syntheticSourceFixtures = [" +
      '{ name: "site", module: "source-registry.ts", value: { candidateParts: [{ sources: [{ pageUrl: "https://shop.example.invalid/item", siteName: "Real Store" }] }] } },' +
      '{ name: "url", module: "source-registry.ts", value: { candidateParts: [{ sources: [{ pageUrl: "https://real.example.com/item", siteName: "架空販売店" }] }] } },' +
      '{ name: "price", module: "source-registry.ts", value: { candidateParts: [{ sources: [{ pageUrl: "https://shop.example.invalid/item", siteName: "架空販売店", price: { original: "data:image/png;base64,AAAA", confirmed: { amount: 1, currency: "SYN" } } }] }] } }' +
      ',{ name: "real-price", module: "source-registry.ts", value: { candidateParts: [{ sources: [{ pageUrl: "https://shop.example.invalid/item", siteName: "架空販売店", price: { original: "$499.99 USD", confirmed: { amount: 49999, currency: "USD" } } }] }] } }' +
      "];",
  );

  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/validate-fixture-assets.mjs",
      paths.fixtures,
      registry,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}${result.stderr}`,
    /non-synthetic-source-site-name/,
  );
  assert.match(`${result.stdout}${result.stderr}`, /non-synthetic-source-url/);
  assert.match(
    `${result.stdout}${result.stderr}`,
    /unsafe-synthetic-source-price/,
  );
  assert.match(
    `${result.stdout}${result.stderr}`,
    /non-synthetic-source-price/,
  );
});

test("validate:fixtures CLIは未登録source fixture moduleを拒否する", async () => {
  const paths = await workspace();
  const unregistered = join(paths.fixtures, "unregistered-source.ts");
  const registry = join(paths.fixtures, "source-registry.ts");
  await writeFile(
    unregistered,
    'export const fixture = { candidateParts: [{ sources: [{ pageUrl: "https://shop.example.invalid/item", siteName: "架空販売店" }] }] };',
  );
  await writeFile(registry, "export const syntheticSourceFixtures = [];");

  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/validate-fixture-assets.mjs",
      paths.fixtures,
      registry,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}${result.stderr}`,
    /unregistered-source-fixture-module/,
  );
});

test("fixture registry完全性はspread・多段alias・computed sourcesを検出し無関係configを除外する", async () => {
  const paths = await workspace();
  const registry = join(paths.fixtures, "source-registry.ts");
  await writeFile(registry, "export const syntheticSourceFixtures = [];");
  await writeFile(
    join(paths.fixtures, "shorthand.ts"),
    "const sources = [{ id: 'source-1', pageUrl: 'https://shop.example.invalid/item', siteName: '架空販売店' }]; export const fixture = { candidateParts: [{ id: 'candidate-1', projectId: 'project-1', sources }] };",
  );
  await writeFile(
    join(paths.fixtures, "computed.ts"),
    "export const fixture = { candidateParts: [{ id: 'candidate-2', projectId: 'project-1', ['sour' + 'ces']: [{ id: 'source-2', pageUrl: 'https://shop.example.invalid/item', siteName: '架空販売店' }] }] };",
  );
  await writeFile(
    join(paths.fixtures, "spread-alias.ts"),
    "const sourceBase = { id: 'source-3', kind: 'retail' }; const sourceDetails = { pageUrl: 'https://shop.example.invalid/item', capturedAt: '2026-01-01T00:00:00.000Z' }; const source = { ...sourceBase, ...sourceDetails }; const first = [source]; const second = first; const sources = [...second]; const candidateBase = { id: 'candidate-3', projectId: 'project-1' }; const candidate = { ...candidateBase, sources }; const aliasOne = candidate; const aliasTwo = aliasOne; export const fixture = { candidateParts: [aliasTwo] };",
  );
  await writeFile(
    join(paths.fixtures, "unrelated-config.ts"),
    "const defaults = { id: 'source-config', kind: 'retail' }; const entry = { ...defaults }; const first = [entry]; const sources = [...first]; export const config = { name: '架空設定', sources };",
  );

  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/validate-fixture-assets.mjs",
      paths.fixtures,
      registry,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  const output = `${result.stdout}${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /shorthand\.ts: unregistered-source-fixture-module/);
  assert.match(output, /computed\.ts: unregistered-source-fixture-module/);
  assert.match(output, /spread-alias\.ts: unregistered-source-fixture-module/);
  assert.doesNotMatch(output, /unrelated-config\.ts/);
});

test("fixture registryは空名と重複名をfail closedで拒否する", async () => {
  const paths = await workspace();
  const registry = join(paths.fixtures, "source-registry.ts");
  await writeFile(
    registry,
    "export const syntheticSourceFixtures = [" +
      "{ name: '', module: 'foundation.ts', value: {} }," +
      "{ name: 'duplicate', module: 'foundation.ts', value: {} }," +
      "{ name: 'duplicate', module: 'foundation.ts', value: {} }" +
      "];",
  );

  const violations = await findFixtureRegistryViolations(registry);
  assert.ok(
    violations.some(({ rule }) => rule === "invalid-source-fixture-registry"),
  );
  assert.ok(
    violations.some(({ rule }) => rule === "duplicate-source-fixture-name"),
  );
});

test("boundary・fixture AST gateは構文エラーで非zero終了する", async () => {
  const paths = await workspace();
  const malformedCatalogDirectory = join(
    paths.fixtures,
    "src",
    "features",
    "candidate-management",
  );
  const malformedCatalog = join(malformedCatalogDirectory, "source-catalog.ts");
  await mkdir(malformedCatalogDirectory, { recursive: true });
  await writeFile(malformedCatalog, "const broken = ;");
  const boundary = spawnSync(
    process.execPath,
    ["scripts/validate-boundaries.mjs", malformedCatalog],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  const registry = join(paths.fixtures, "source-registry.ts");
  await writeFile(registry, "export const syntheticSourceFixtures = [];");
  await writeFile(join(paths.fixtures, "broken.ts"), "const broken = ;");
  const fixtures = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/validate-fixture-assets.mjs",
      paths.fixtures,
      registry,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert.notEqual(boundary.status, 0);
  assert.match(`${boundary.stdout}${boundary.stderr}`, /syntactic diagnostics/);
  assert.notEqual(fixtures.status, 0);
  assert.match(`${fixtures.stdout}${fixtures.stderr}`, /syntactic diagnostics/);
});

test("boundary CLIは通常feature・shell・公開consumerの構文エラーも拒否する", async () => {
  const paths = await workspace();
  const root = dirname(paths.source);
  const malformed = [
    join(root, "src", "features", "ordinary", "public.ts"),
    join(root, "src", "application-shell", "composition.ts"),
    join(root, "tests", "tooling", "public-api-consumer.ts"),
  ];
  for (const path of malformed) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "const broken = ;");
  }

  const result = spawnSync(
    process.execPath,
    ["scripts/validate-boundaries.mjs", ...malformed],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /syntactic diagnostics/);
});

test("foundation公開bundleを生成しないbuildをfail closedに拒否する", async () => {
  const paths = await workspace();
  await assert.rejects(
    runFinalGate({
      outputDirectory: paths.output,
      boundaryRoots: [paths.source],
      fixtureRoots: [paths.fixtures],
      build: async (output = "") => {
        await mkdir(output, { recursive: true });
        await writeFile(
          join(output, "manifest.json"),
          JSON.stringify(validManifest),
        );
        await writeFile(
          join(output, "build-contract.js"),
          "export const ready=true;",
        );
      },
    }),
    /foundation\.js/,
  );
});

test("source境界・fixture違反とmissing rootをfail closedに伝播する", async () => {
  const violations = [
    'import "../persistence/internal/storage.js";',
    "chrome.storage.local.set({});",
    'navigator.locks.request("pc-build-planner:local-data-root-write", () => {});',
  ];
  for (const source of violations) {
    const paths = await workspace();
    await writeFile(paths.source, source);
    await assert.rejects(
      runFinalGate({
        outputDirectory: paths.output,
        boundaryRoots: [paths.source],
        fixtureRoots: [paths.fixtures],
        build: builder(),
      }),
    );
  }
  const paths = await workspace();
  await writeFile(join(paths.fixtures, "photo.png"), "synthetic bytes");
  await assert.rejects(
    runFinalGate({
      outputDirectory: paths.output,
      boundaryRoots: [paths.source],
      fixtureRoots: [paths.fixtures],
      build: builder(),
    }),
    /source fixture validation/,
  );
  await assert.rejects(
    runFinalGate({
      outputDirectory: paths.output,
      boundaryRoots: [join(paths.output, "missing")],
      fixtureRoots: [paths.fixtures],
      build: builder(),
    }),
    /does not exist/,
  );
});

test("manifest・code・公開境界・fixtureのartifact違反をすべて伝播する", async () => {
  const cases = [
    builder({ ...validManifest, permissions: ["storage", "tabs"] }),
    builder({
      ...validManifest,
      permissions: [...validManifest.permissions, "alarms"],
    }),
    builder({
      ...validManifest,
      permissions: ["storage", "activeTab", "scripting", "sidePanel"],
    }),
    builder({
      ...validManifest,
      host_permissions: ["https://example.invalid/*"],
    }),
    builder({ ...validManifest, optional_permissions: ["tabs"] }),
    builder({
      ...validManifest,
      optional_host_permissions: ["https://example.invalid/*"],
    }),
    builder({
      ...validManifest,
      content_security_policy: { extension_pages: "script-src *" },
    }),
    builder(validManifest, {
      "remote.js": 'import "https://example.invalid/x.js";',
    }),
    builder(validManifest, { "eval.js": "eval('x')" }),
    builder(validManifest, {
      "runtime-jsx.js":
        'import "@babel/standalone"; Babel.transform(source, {presets:["react"]});',
    }),
    builder(validManifest, {
      "unsafe-html.js":
        "const props={dangerouslySetInnerHTML:{__html:external}};",
    }),
    builder(validManifest, {
      "unsafe-inner-html.js":
        "node.innerHTML=external; other['innerHTML'] = external;",
    }),
    builder(validManifest, {
      "service-worker.js":
        'import React from "react"; document.createElement("div");',
    }),
    builder(validManifest, {
      "side-panel.js": "export const started=true;",
    }),
    builder(validManifest, {
      "dummy.js":
        'const maintenanceSource={getSnapshot:async()=>({status:"inactive"}),subscribe:()=>()=>{}};',
    }),
    builder(validManifest, {
      "noop.js": "start({onStateChange:()=>{}});",
    }),
    builder(validManifest, {
      "self-register.js":
        "featureContributionCatalog.push({key:'mock',registration:mockRegistration});",
    }),
    builder(validManifest, { "inline.html": "<script>alert(1)</script>" }),
    builder(validManifest, {
      "deep.js": 'import "./persistence/internal/storage.js";',
    }),
    builder(validManifest, { "storage.js": "chrome.storage.local.get();" }),
    builder(validManifest, {
      "lock.js":
        'navigator.locks.request("pc-build-planner:local-data-root-write",()=>{});',
    }),
    builder(validManifest, { "photo.png": "synthetic bytes" }),
    builder(validManifest, {
      "foundation.js":
        "const initializeProductionFoundationRuntimeContribution=()=>{}; const createWriteAuthority=()=>{}; export { initializeProductionFoundationRuntimeContribution, createWriteAuthority };",
    }),
    builder(validManifest, {
      "foundation.js":
        "const createCompositionRoot=()=>{}; export { createCompositionRoot };",
    }),
    builder(validManifest, {
      "foundation.js":
        "const initializeProductionFoundationRuntimeContribution=()=>{},createWriteAuthority=()=>{};export{initializeProductionFoundationRuntimeContribution,createWriteAuthority as x};",
    }),
    builder(validManifest, {
      "foundation.js":
        "export const initializeProductionFoundationRuntimeContribution=()=>{},createWriteAuthority=()=>{};",
    }),
  ];
  for (const build of cases) {
    const paths = await workspace();
    await assert.rejects(
      runFinalGate({
        outputDirectory: paths.output,
        boundaryRoots: [paths.source],
        fixtureRoots: [paths.fixtures],
        build,
      }),
    );
  }
});
