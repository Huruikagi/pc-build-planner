import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runFinalGate } from "../../scripts/validate-final-gate.mjs";
import { findFixtureAssetViolations } from "../../scripts/validate-fixture-assets.mjs";

const validManifest = {
  manifest_version: 3,
  name: "Synthetic extension",
  version: "1.0.0",
  minimum_chrome_version: "116",
  permissions: ["storage"],
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
    manifest: typeof validManifest = validManifest,
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
      "const initializeFoundationRuntimeContribution=()=>{}; export { initializeFoundationRuntimeContribution };",
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
        "const initializeFoundationRuntimeContribution=()=>{}; const createWriteAuthority=()=>{}; export { initializeFoundationRuntimeContribution, createWriteAuthority };",
    }),
    builder(validManifest, {
      "foundation.js":
        "const createCompositionRoot=()=>{}; export { createCompositionRoot };",
    }),
    builder(validManifest, {
      "foundation.js":
        "const initializeFoundationRuntimeContribution=()=>{},createWriteAuthority=()=>{};export{initializeFoundationRuntimeContribution,createWriteAuthority as x};",
    }),
    builder(validManifest, {
      "foundation.js":
        "export const initializeFoundationRuntimeContribution=()=>{},createWriteAuthority=()=>{};",
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
