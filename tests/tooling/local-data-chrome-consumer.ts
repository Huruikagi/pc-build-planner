import assert from "node:assert/strict";

import {
  type ChromeLocksApi,
  createChromeExclusiveLockAdapter,
} from "@pc-build-planner/local-data/chrome";

const locks: ChromeLocksApi = {
  async request(_name, options, callback) {
    assert.equal(options.mode, "exclusive");
    return callback();
  },
};

const adapter = createChromeExclusiveLockAdapter(locks, "fixture-lock");
const result = await adapter.runExclusive(async () => "locked");

assert.deepEqual(result, { ok: true, value: "locked" });
