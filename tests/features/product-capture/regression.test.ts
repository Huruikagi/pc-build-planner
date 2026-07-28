import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
