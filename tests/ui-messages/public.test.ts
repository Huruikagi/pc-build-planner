import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultMessageResolver,
  message,
} from "../../src/ui-messages/public.js";

test("公開入口のdefaultMessageResolverが同梱カタログを解決する", () => {
  assert.equal(defaultMessageResolver("common.save"), "保存");
});

test("公開入口のmessageが型安全な記述子を作る", () => {
  assert.deepEqual(message("common.save"), { key: "common.save" });
});
