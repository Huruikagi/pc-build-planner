import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { packageExtension } from "../../scripts/package.mjs";

const execFileAsync = promisify(execFile);

const validManifest = {
  manifest_version: 3,
  name: "Synthetic extension",
  version: "1.0.0",
  minimum_chrome_version: "116",
  permissions: ["storage", "activeTab", "scripting", "sidePanel"],
  action: {},
  background: { service_worker: "service-worker.js", type: "module" },
  side_panel: { default_path: "side-panel.html" },
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'",
  },
};

async function writeValidBuildOutput(outputDirectory: string) {
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    join(outputDirectory, "manifest.json"),
    JSON.stringify(validManifest),
  );
  await writeFile(
    join(outputDirectory, "side-panel.html"),
    '<main id="application-shell"></main><script type="module" src="./side-panel.js"></script>',
  );
  await writeFile(
    join(outputDirectory, "side-panel.js"),
    "/* node_modules/react/cjs/react.production.js */ /* node_modules/react-dom/cjs/react-dom-client.production.js */ export const started=true;",
  );
  await writeFile(
    join(outputDirectory, "service-worker.js"),
    "export const registered=true;",
  );
  await writeFile(join(outputDirectory, ".build-ready"), "unpacked\n");
}

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "package-"));
  await writeFile(
    join(root, "manifest.json"),
    JSON.stringify({ version: "1.0.0" }),
  );
  await writeFile(join(root, "package.json"), JSON.stringify({ version: "1.0.0" }));
  return root;
}

async function listZipEntries(zipPath: string) {
  const { stdout } = await execFileAsync("unzip", ["-Z1", zipPath]);
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

test("配布対象のみをステージングしdotで始まるファイルを除外する", async () => {
  const root = await workspace();
  const outputDirectory = join(root, "dist");
  await writeValidBuildOutput(outputDirectory);

  const result = await packageExtension({
    outputDirectory,
    releaseDirectory: join(root, "release"),
    rootDirectory: root,
  });

  assert.ok(!result.includedFiles.some((path) => path.split(/[\\/]/).some((part) => part.startsWith("."))));
  const entries = await listZipEntries(result.zipPath);
  assert.ok(!entries.some((entry) => entry.split("/").some((part) => part.startsWith("."))));
});

test("展開結果の最上位にmanifestが来る構造にする", async () => {
  const root = await workspace();
  const outputDirectory = join(root, "dist");
  await writeValidBuildOutput(outputDirectory);

  const result = await packageExtension({
    outputDirectory,
    releaseDirectory: join(root, "release"),
    rootDirectory: root,
  });

  const entries = await listZipEntries(result.zipPath);
  assert.ok(entries.includes("manifest.json"), entries.join(","));
});

test("zipファイル名はバージョンから導出された名前になる", async () => {
  const root = await workspace();
  const outputDirectory = join(root, "dist");
  await writeValidBuildOutput(outputDirectory);

  const result = await packageExtension({
    outputDirectory,
    releaseDirectory: join(root, "release"),
    rootDirectory: root,
  });

  assert.match(result.zipPath, /pc-build-planner-v1\.0\.0\.zip$/);
  await access(result.zipPath);
});

test("成果物検査に失敗した場合はzipを生成しない", async () => {
  const root = await workspace();
  const outputDirectory = join(root, "dist");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    join(outputDirectory, "manifest.json"),
    JSON.stringify(validManifest),
  );
  // side-panel.html / side-panel.js / service-worker.js are missing on purpose.

  await assert.rejects(
    packageExtension({
      outputDirectory,
      releaseDirectory: join(root, "release"),
      rootDirectory: root,
    }),
  );
  await assert.rejects(access(join(root, "release", "pc-build-planner-v1.0.0.zip")));
});

test("再実行時にステージングと既存zipの残骸を持ち越さない", async () => {
  const root = await workspace();
  const outputDirectory = join(root, "dist");
  await writeValidBuildOutput(outputDirectory);
  const releaseDirectory = join(root, "release");

  await packageExtension({ outputDirectory, releaseDirectory, rootDirectory: root });

  const stalePath = join(releaseDirectory, "package", "stale-leftover.txt");
  await mkdir(join(releaseDirectory, "package"), { recursive: true });
  await writeFile(stalePath, "leftover");

  const result = await packageExtension({
    outputDirectory,
    releaseDirectory,
    rootDirectory: root,
  });

  await assert.rejects(access(stalePath));
  const entries = await listZipEntries(result.zipPath);
  assert.ok(!entries.includes("stale-leftover.txt"));
});
