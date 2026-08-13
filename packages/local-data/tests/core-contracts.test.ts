import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const packageRoot = new URL("../", import.meta.url);

test("the root declaration stays product and platform independent", async () => {
  const declarationDirectory = new URL("dist/", packageRoot);
  const pending = ["index.d.ts"];
  const visited = new Set<string>();
  const declarations: string[] = [];

  while (pending.length > 0) {
    const declarationPath = pending.pop();
    if (declarationPath === undefined) {
      throw new Error("declaration graph queue was unexpectedly empty");
    }
    if (visited.has(declarationPath)) {
      continue;
    }

    visited.add(declarationPath);
    const declaration = await readFile(
      new URL(declarationPath, declarationDirectory),
      "utf8",
    );
    declarations.push(declaration);

    for (const match of declaration.matchAll(/\bfrom\s+["'](\.[^"']+)["']/g)) {
      const specifier = match[1];
      if (specifier === undefined) {
        throw new Error("declaration import did not contain a specifier");
      }
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
    "contracts.d.ts",
    "fencing.d.ts",
    "index.d.ts",
    "transaction.d.ts",
  ]);
  const declaration = declarations.join("\n");

  for (const forbiddenName of [
    "LocalDataRoot",
    "FoundationError",
    "Chrome",
    "React",
    "Zod",
  ]) {
    assert.equal(declaration.includes(forbiddenName), false, forbiddenName);
  }
});
