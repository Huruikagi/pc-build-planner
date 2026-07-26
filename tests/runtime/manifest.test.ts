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
  name: "__MSG_extensionName__",
  description: "__MSG_extensionDescription__",
  version: "0.1.0",
  default_locale: "en",
  minimum_chrome_version: "116",
  permissions: ["storage", "activeTab", "scripting", "sidePanel"],
  action: {},
  background: { service_worker: "service-worker.js", type: "module" },
  side_panel: { default_path: "side-panel.html" },
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'",
  },
};

test("manifestはChrome 116以降向けの最小MV3契約である", async () => {
  const manifest = JSON.parse(await readFile("manifest.json", "utf8"));

  assert.deepEqual(manifest, validManifest);
  assert.doesNotThrow(() => validateManifest(manifest));
  assert.deepEqual(manifest.background, {
    service_worker: "service-worker.js",
    type: "module",
  });
  assert.equal(manifest.side_panel.default_path, "side-panel.html");
  assert.deepEqual(manifest.action, {});
  assert.deepEqual(manifest.permissions, [
    "storage",
    "activeTab",
    "scripting",
    "sidePanel",
  ]);
});

test("禁止権限と全サイト権限を拒否する", () => {
  for (const manifest of [
    { ...validManifest, permissions: ["storage", "unlimitedStorage"] },
    { ...validManifest, permissions: ["storage", "tabs"] },
    { ...validManifest, permissions: ["storage", "storage"] },
    { ...validManifest, permissions: ["activeTab", "scripting"] },
    { ...validManifest, host_permissions: ["<all_urls>"] },
    { ...validManifest, optional_host_permissions: ["https://*/*"] },
  ]) {
    assert.throws(() => validateManifest(manifest));
  }
});

test("actionが未宣言または不正な形状の場合は拒否する", () => {
  for (const manifest of [
    (() => {
      const { action, ...rest } = validManifest;
      return rest;
    })(),
    { ...validManifest, action: null },
    { ...validManifest, action: [] },
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
    await writeFile(
      join(directory, "side-panel.html"),
      '<main id="application-shell"></main><script type="module" src="./side-panel.js"></script>',
    );
    await writeFile(
      join(directory, "side-panel.js"),
      "/* node_modules/react/cjs/react.production.js */ /* node_modules/react-dom/cjs/react-dom-client.production.js */ export {};\n",
    );
    await writeFile(join(directory, "service-worker.js"), "export {};\n");

    for (const fixture of [
      {
        fileName: "remote.js",
        source: 'import "https://example.invalid/code.js";',
        expected: /remote import found/,
      },
      {
        fileName: "eval.js",
        source: 'eval("1 + 1");',
        expected: /eval found/,
      },
      {
        fileName: "function.js",
        source: 'new Function("return 1")();',
        expected: /new Function found/,
      },
      {
        fileName: "inline.html",
        source: "<script>alert(1)</script>",
        expected: /inline script found/,
      },
      {
        fileName: "handler.html",
        source: '<button onclick="alert(1)">x</button>',
        expected: /inline JavaScript found/,
      },
      {
        fileName: "spaced-inline.html",
        source: "<script>alert(1)</script   >",
        expected: /inline script found/,
      },
      {
        fileName: "protocol-relative.html",
        source:
          '<script type="module" src="//remote.example.invalid/code.js"></script>',
        expected: /bundled local JavaScript file/,
      },
      {
        fileName: "classic.html",
        source: '<script src="./side-panel.js"></script>',
        expected: /non-module script found/,
      },
      {
        fileName: "data-attributes.html",
        source:
          '<script data-type="module" data-src="./side-panel.js"></script>',
        expected: /non-module script found/,
      },
      {
        fileName: "missing-target.html",
        source: '<script type="module" src="./missing-side-panel.js"></script>',
        expected: /referenced script is missing/,
      },
      {
        fileName: "duplicate-attribute.html",
        source:
          '<script type="module" type="module" src="./side-panel.js"></script>',
        expected: /duplicate script attribute/,
      },
      {
        fileName: "malformed-attribute.html",
        source: '<script type="module" async src="./side-panel.js"></script>',
        expected: /malformed script attributes/,
      },
    ]) {
      await writeFile(join(directory, fixture.fileName), fixture.source);
      await assert.rejects(
        validateArtifactDirectory(directory),
        fixture.expected,
      );
      await rm(join(directory, fixture.fileName));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("side panel documentは同梱module bootstrapだけを読み込む", async () => {
  const html = await readFile("side-panel.html", "utf8");

  assert.match(html, /<main\s+id=["']application-shell["']/i);
  assert.match(
    html,
    /<script\s+type=["']module["']\s+src=["']\.\/side-panel\.js["']><\/script>/i,
  );
  assert.doesNotMatch(
    html,
    /<script\b[^>]*>(?!\s*<\/script>)[\s\S]*?<\/script>/i,
  );
  assert.doesNotMatch(html, /https?:\/\//i);
  // 表示言語はランタイムが決定する（5.3）。静的な既定言語という事実を
  // 文書に残さない。
  assert.doesNotMatch(html, /<html\b[^>]*\blang=/i);
});
