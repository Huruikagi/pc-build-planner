import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  validateArtifactDirectory,
  validateManifest,
} from "../../scripts/validate-artifacts.mjs";

const validManifest = {
  manifest_version: 3,
  name: "PC Build Planner",
  version: "1.0.0",
  minimum_chrome_version: "116",
  permissions: ["storage"],
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'",
  },
};

test("manifestはChrome 116以降向けの最小MV3契約である", async () => {
  const manifest = JSON.parse(await readFile("manifest.json", "utf8"));

  assert.deepEqual(manifest, validManifest);
  assert.doesNotThrow(() => validateManifest(manifest));
  assert.equal("background" in manifest, false);
  assert.equal("side_panel" in manifest, false);
});

test("禁止権限と全サイト権限を拒否する", () => {
  for (const manifest of [
    { ...validManifest, permissions: ["storage", "unlimitedStorage"] },
    { ...validManifest, host_permissions: ["<all_urls>"] },
    { ...validManifest, optional_host_permissions: ["https://*/*"] },
  ]) {
    assert.throws(() => validateManifest(manifest));
  }
});

test("remote code、動的評価、inline JavaScriptを生成物から拒否する", async () => {
  const directory = await mkdtemp(join(tmpdir(), "artifact-validation-"));
  try {
    await writeFile(
      join(directory, "manifest.json"),
      JSON.stringify(validManifest),
    );

    for (const fixture of [
      {
        fileName: "remote.js",
        source: 'import "https://example.invalid/code.js";',
      },
      { fileName: "eval.js", source: 'eval("1 + 1");' },
      { fileName: "function.js", source: 'new Function("return 1")();' },
      { fileName: "inline.html", source: "<script>alert(1)</script>" },
      {
        fileName: "handler.html",
        source: '<button onclick="alert(1)">x</button>',
      },
    ]) {
      await writeFile(join(directory, fixture.fileName), fixture.source);
      await assert.rejects(validateArtifactDirectory(directory));
      await rm(join(directory, fixture.fileName));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
