import assert from "node:assert/strict";
import test from "node:test";

import type { CurrentBuildQuery } from "../../../src/features/current-build/contracts.js";
import {
  type CurrentBuildPublicDependencies,
  createCurrentBuildPublicApi,
} from "../../../src/features/current-build/public.js";

test("公開入口は下流向けの読取専用query契約だけを公開する", () => {
  const query = {} as CurrentBuildQuery;
  const api = createCurrentBuildPublicApi({ query });

  assert.equal(api.query, query);
  assert.equal(Object.isFrozen(api), true);
});

test("公開入口はquery依存がなければ組み立てを拒否する", () => {
  assert.throws(
    () => createCurrentBuildPublicApi({} as CurrentBuildPublicDependencies),
    /query/,
  );
});
