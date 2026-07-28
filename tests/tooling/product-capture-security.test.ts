import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateCaptureDiagnosticSource } from "../../scripts/validate-artifacts.mjs";
import {
  findFixtureAssetViolations,
  findFixtureValueViolations,
  findSyntheticDomainViolations,
} from "../../scripts/validate-fixture-assets.mjs";

test("domain map fixtureは架空domainとsynthetic値だけを許可する", () => {
  assert.deepEqual(
    findSyntheticDomainViolations({
      registrableDomain: "maker.example.invalid",
      manufacturer: "SYN 架空メーカー",
      evidenceUrl: "https://maker.example.invalid/about",
    }),
    [],
  );
  assert.deepEqual(
    findSyntheticDomainViolations({ registrableDomain: "vendor.com" }),
    [{ path: "$.registrableDomain", rule: "non-synthetic-domain" }],
  );
  assert.deepEqual(
    findFixtureValueViolations({
      manufacturer: { original: "実商品メーカー", confirmed: "実商品メーカー" },
    }),
    [{ path: "$.manufacturer", rule: "non-synthetic-sourced-value" }],
  );
});

test("fixture gateは非synthetic domain map assetを拒否する", async () => {
  assert.deepEqual(
    await findFixtureAssetViolations(undefined, [
      {
        path: "tests/fixtures/domain-map.ts",
        content: 'export const fixture = { registrableDomain: "vendor.com" };',
      },
    ]),
    [
      {
        path: "tests/fixtures/domain-map.ts",
        rule: "non-synthetic-domain",
      },
    ],
  );
});

test("capture診断は安定code以外のページ値と例外objectを拒否する", () => {
  assert.doesNotThrow(() =>
    validateCaptureDiagnosticSource(
      'console.error("product-capture: injection-failed")',
      "dist/side-panel.js",
    ),
  );
  for (const source of [
    "console.error(pageUrl)",
    "console.warn(hostname)",
    "console.error(rawHtml)",
    "console.error(extractedProduct)",
    "console.error(error)",
  ]) {
    assert.throws(
      () => validateCaptureDiagnosticSource(source, "dist/side-panel.js"),
      /page-derived capture diagnostic/,
    );
  }
});

test("production capture error pathはページ値をlogせずruntimeは安定codeだけを渡す", async () => {
  const captureSources = await Promise.all(
    [
      "src/features/product-capture/coordinator.ts",
      "src/features/product-capture/state.ts",
      "src/features/product-capture/content-script.ts",
    ].map((path) => readFile(path, "utf8")),
  );
  for (const [index, source] of captureSources.entries()) {
    assert.doesNotThrow(() =>
      validateCaptureDiagnosticSource(source, `capture-source-${index}.ts`),
    );
    assert.doesNotMatch(source, /console\s*\./);
  }
  const worker = await readFile("src/runtime/service-worker.ts", "utf8");
  assert.match(
    worker,
    /reportDiagnostic:\s*\(code\)\s*=>\s*console\.error\(`transient-runtime: \$\{code\}`\)/,
  );
});
