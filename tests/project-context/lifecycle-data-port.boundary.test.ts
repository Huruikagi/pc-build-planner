import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("project-context adapter does not reimplement or import foundation repair policy", async () => {
  const source = await readFile(
    new URL(
      "../../src/project-context/lifecycle-data-port.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(source, /from "\.\.\/persistence\/public\.js"/);
  assert.doesNotMatch(
    source,
    /reference-repair|repairPolicy|candidateParts|currentBuilds/,
  );
  assert.equal((source.match(/foundation\.mutate\(/g) ?? []).length, 1);
});
