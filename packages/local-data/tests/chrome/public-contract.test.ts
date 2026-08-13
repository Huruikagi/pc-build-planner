import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const packageRoot = new URL("../../", import.meta.url);

test("the chrome declaration graph exposes only storage and lock adapters", async () => {
  const declarationDirectory = new URL("dist/", packageRoot);
  const pending = ["chrome/index.d.ts"];
  const visited = new Set<string>();
  const declarations: string[] = [];

  while (pending.length > 0) {
    const declarationPath = pending.pop();
    assert.ok(declarationPath);
    if (visited.has(declarationPath)) continue;

    visited.add(declarationPath);
    const declaration = await readFile(
      new URL(declarationPath, declarationDirectory),
      "utf8",
    );
    declarations.push(declaration);

    for (const match of declaration.matchAll(/\bfrom\s+["'](\.[^"']+)["']/g)) {
      const specifier = match[1];
      assert.ok(specifier);
      pending.push(
        path.posix.normalize(
          path.posix.join(
            path.posix.dirname(declarationPath),
            specifier.replace(/\.js$/, ".d.ts"),
          ),
        ),
      );
    }
  }

  assert.deepEqual([...visited].sort(), [
    "chrome/index.d.ts",
    "chrome/locks-adapter.d.ts",
    "chrome/storage-adapter.d.ts",
    "contracts.d.ts",
  ]);

  const declaration = declarations.join("\n");
  for (const forbiddenName of [
    "LocalDataRoot",
    "foundationRoot",
    "runtimeMessage",
    "ApplicationShell",
    "ProductLocalDataAdapter",
  ]) {
    assert.equal(declaration.includes(forbiddenName), false, forbiddenName);
  }
});

