import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { createProductionLanguagePlatform } from "../../src/ui-language/runtime.js";

const originalChrome = globalThis.chrome;

afterEach(() => {
  Object.assign(globalThis, { chrome: originalChrome });
});

test("production language platformはChrome不在時も安全なfallbackを返す", async () => {
  Object.assign(globalThis, { chrome: undefined });

  const platform = createProductionLanguagePlatform();

  assert.equal(platform.browserUiLanguage(), undefined);
  assert.deepEqual(await platform.preferences.read(), {
    ok: true,
    value: undefined,
  });
  assert.equal((await platform.preferences.write("en")).ok, true);
  assert.deepEqual(await platform.preferences.read(), {
    ok: true,
    value: "en",
  });
});
