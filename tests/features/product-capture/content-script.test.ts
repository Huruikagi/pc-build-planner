import assert from "node:assert/strict";
import test from "node:test";

test("content-scriptはページ内へ抽出用の既定nameを公開する", async () => {
  document.body.innerHTML = "<h1>架空スパースCPU</h1>";

  await import("../../../src/features/product-capture/content-script.js");

  const globalWithHook = globalThis as typeof globalThis & {
    __pcbpExtract?: () => unknown;
  };
  assert.equal(typeof globalWithHook.__pcbpExtract, "function");

  const result = globalWithHook.__pcbpExtract?.() as {
    readonly pageUrl?: unknown;
    readonly candidates?: unknown;
  };

  assert.ok(Array.isArray(result.candidates));
  assert.ok(
    (result.candidates as readonly unknown[]).some(
      (candidate) =>
        typeof candidate === "object" &&
        candidate !== null &&
        (candidate as { rawValue?: unknown }).rawValue === "架空スパースCPU",
    ),
  );
});

test("content-scriptは抽出実行時のlocation.hrefを結果へ添える", async () => {
  document.body.innerHTML = "<h1>架空スパースCPU</h1>";

  await import("../../../src/features/product-capture/content-script.js");

  const result = (
    globalThis as typeof globalThis & { __pcbpExtract?: () => unknown }
  ).__pcbpExtract?.() as { readonly pageUrl?: unknown };

  assert.equal(result.pageUrl, location.href);
});
