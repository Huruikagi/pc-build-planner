import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("実side-panel bundleだけへReact runtimeを自己完結で同梱する", async () => {
  const bundle = await readFile("dist/side-panel.js", "utf8");

  assert.match(bundle, /react-jsx-runtime\.production/);
  assert.match(bundle, /react-dom-client\.production/);
  assert.doesNotMatch(
    bundle,
    /\b(?:eval|Function)\s*\(|@jsx|import\s*\(\s*["']https?:/,
  );
  await assert.rejects(
    readFile("dist/react-runtime.js", "utf8"),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "ENOENT",
  );
});
