import assert from "node:assert/strict";
import test from "node:test";

import type { CompatibilityQuery } from "../../../src/features/compatibility/contracts.js";
import {
  type CompatibilityPublicDependencies,
  createCompatibilityPublicApi,
} from "../../../src/features/compatibility/public.js";

test("公開入口は下流向けの読取専用query契約だけを公開する", () => {
  const query = {} as CompatibilityQuery;
  const api = createCompatibilityPublicApi({ query });

  assert.equal(api.query, query);
  assert.equal(Object.isFrozen(api), true);
});

test("公開入口はquery依存がなければ組み立てを拒否する", () => {
  assert.throws(
    () => createCompatibilityPublicApi({} as CompatibilityPublicDependencies),
    /query/,
  );
});
