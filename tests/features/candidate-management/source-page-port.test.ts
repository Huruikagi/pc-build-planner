import assert from "node:assert/strict";
import test from "node:test";
import { createChromeSourcePagePort } from "../../../src/features/candidate-management/source-page-port.js";

test("HTTP/HTTPSだけを一回のtabs.createへ渡す", async () => {
  const calls: unknown[] = [];
  const port = createChromeSourcePagePort({
    create: async (details) => {
      calls.push(details);
      return {};
    },
  });
  assert.deepEqual(await port.open("https://example.invalid/item"), {
    ok: true,
    value: undefined,
  });
  assert.deepEqual(calls, [{ url: "https://example.invalid/item" }]);
  assert.deepEqual(await port.open("http://example.invalid/item"), {
    ok: true,
    value: undefined,
  });
  assert.deepEqual(calls[1], { url: "http://example.invalid/item" });
  assert.deepEqual(await port.open("javascript:alert(1)"), {
    ok: false,
    error: { kind: "invalid-url" },
  });
  assert.equal(calls.length, 2);
});

test("runtime不在とAPI失敗をURLを含まないerrorへ変換する", async () => {
  assert.deepEqual(
    await createChromeSourcePagePort().open("https://example.invalid"),
    { ok: false, error: { kind: "runtime-unavailable" } },
  );
  const failed = createChromeSourcePagePort({
    create: async () => {
      throw new Error("https://secret.invalid");
    },
  });
  assert.deepEqual(await failed.open("https://secret.invalid"), {
    ok: false,
    error: { kind: "open-failed" },
  });
});
