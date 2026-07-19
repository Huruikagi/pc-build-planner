import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { act } from "react";

import { mountRuntimeBaseline } from "../../src/application-shell/runtime-baseline.js";

test("React componentをDOM環境へ描画してcleanupできる", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  let unmount = () => {};

  await act(() => {
    unmount = mountRuntimeBaseline(container, "Application shell");
  });

  assert.equal(container.textContent, "Application shell");

  await act(() => unmount());
  assert.equal(container.textContent, "");
  container.remove();
});

test("production bundleへReact runtimeを自己完結で同梱する", async () => {
  const bundle = await readFile("dist/react-runtime.js", "utf8");

  assert.match(bundle, /react-jsx-runtime\.production/);
  assert.match(bundle, /react-dom-client\.production/);
  assert.doesNotMatch(
    bundle,
    /\b(?:eval|Function)\s*\(|@jsx|import\s*\(\s*["']https?:/,
  );
});
