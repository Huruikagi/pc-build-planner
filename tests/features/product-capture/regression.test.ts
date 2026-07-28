import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import test from "node:test";

test("product-capture runtimeはactive tab再解決を含まない", async () => {
  const source = await readFile(
    new URL(
      "../../../src/features/product-capture/chrome-runtime-port.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.doesNotMatch(source, /tabs\.query|getActiveTab|captureCurrentTab/);
  assert.match(source, /tabs\.get/);
});

test("product-capture境界から旧保存・worker・直接navigation経路を除去する", async () => {
  const featureRoot = new URL(
    "../../../src/features/product-capture/",
    import.meta.url,
  );
  const removedModules = [
    "submit-draft.ts",
    "worker-registration.ts",
    "editor-navigation.ts",
  ];

  for (const moduleName of removedModules) {
    await assert.rejects(access(new URL(moduleName, featureRoot)));
  }

  const productionFiles = (await readdir(featureRoot)).filter(
    (moduleName) => moduleName.endsWith(".ts") || moduleName.endsWith(".tsx"),
  );
  const source = (
    await Promise.all(
      productionFiles.map((moduleName) =>
        readFile(new URL(moduleName, featureRoot), "utf8"),
      ),
    )
  ).join("\n");
  assert.doesNotMatch(
    source,
    /CaptureCandidatePort|CaptureSubmitOutcome|\bCaptureSession\b|ConfirmedCaptureSession|submitDraft|onCaptured|retryHandoff|openCandidateEditor|captureCurrentTab|tabs\.query|getActiveTab|toCandidateDraft|data-capture-submit|data-region=["']review["']|status:\s*["'](?:review|submitting|saved)["']/,
  );
});
