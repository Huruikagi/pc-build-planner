import assert from "node:assert/strict";
import test from "node:test";

import { applicationApi } from "../../src/index.js";

test("root公開入口は空catalogから合成したreadonly own-property辞書だけを提供する", () => {
  assert.deepEqual(Object.keys(applicationApi), []);
  assert.equal(Object.getPrototypeOf(applicationApi), null);
  assert.equal(Object.isFrozen(applicationApi), true);
});
