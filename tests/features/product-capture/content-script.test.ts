import assert from "node:assert/strict";
import test from "node:test";

test("content-scriptはページ内へ抽出用の既定nameを公開する", async () => {
  document.body.innerHTML = "<h1>架空スパースCPU</h1>";

  await import("../../../src/features/product-capture/content-script.js");

  const globalWithHook = globalThis as typeof globalThis & {
    __pcbpExtract?: () => unknown;
  };
  assert.equal(typeof globalWithHook.__pcbpExtract, "function");

  const result = globalWithHook.__pcbpExtract?.();

  assert.ok(Array.isArray(result));
  assert.ok(
    (result as readonly unknown[]).some(
      (candidate) =>
        typeof candidate === "object" &&
        candidate !== null &&
        (candidate as { rawValue?: unknown }).rawValue === "架空スパースCPU",
    ),
  );
});
