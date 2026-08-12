import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("package scaffold remains private and runtime dependency-free", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as Record<string, unknown>;

  assert.equal(manifest.private, true);
  assert.equal(manifest.type, "module");
  assert.equal("dependencies" in manifest, false);
  assert.equal("peerDependencies" in manifest, false);
  assert.deepEqual(manifest.exports, {
    ".": {
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
    },
  });
});
