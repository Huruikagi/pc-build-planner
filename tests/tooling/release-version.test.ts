import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveReleaseVersion } from "../../scripts/release-version.mjs";

async function workspace(manifestVersion: string, packageVersion: string) {
  const root = await mkdtemp(join(tmpdir(), "release-version-"));
  await writeFile(
    join(root, "manifest.json"),
    JSON.stringify({ version: manifestVersion }),
  );
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ version: packageVersion }),
  );
  return root;
}

test("manifestのversionからtagとzipファイル名を導出する", async () => {
  const rootDirectory = await workspace("0.2.0", "0.2.0");

  const result = await resolveReleaseVersion({ rootDirectory });

  assert.deepEqual(result, {
    version: "0.2.0",
    tag: "v0.2.0",
    zipFileName: "pc-build-planner-v0.2.0.zip",
  });
});

test("manifestとpackageのversion不一致を双方の実測値つきで失敗させる", async () => {
  const rootDirectory = await workspace("0.2.0", "0.1.0");

  await assert.rejects(
    resolveReleaseVersion({ rootDirectory }),
    /0\.2\.0.*0\.1\.0|0\.1\.0.*0\.2\.0/s,
  );
});

test("versionが未定義の場合に失敗させる", async () => {
  const root = await mkdtemp(join(tmpdir(), "release-version-"));
  await writeFile(join(root, "manifest.json"), JSON.stringify({}));
  await writeFile(join(root, "package.json"), JSON.stringify({ version: "0.1.0" }));

  await assert.rejects(resolveReleaseVersion({ rootDirectory: root }));
});

test("versionが空文字の場合に失敗させる", async () => {
  const rootDirectory = await workspace("", "");

  await assert.rejects(resolveReleaseVersion({ rootDirectory }));
});
