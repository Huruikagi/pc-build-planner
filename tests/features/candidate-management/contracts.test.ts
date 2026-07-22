import assert from "node:assert/strict";
import test from "node:test";
import type { CandidateDraft } from "../../../src/features/candidate-management/public.js";
import {
  type CandidateManagementPublicDependencies,
  type CandidateQuery,
  type CaptureCandidatePort,
  createCandidateManagementPublicApi,
} from "../../../src/features/candidate-management/public.js";
import type { FoundationScopedDataPort } from "../../../src/persistence/public.js";

test("公開入口は照会と取り込み候補作成portを公開する", () => {
  const query = {} as CandidateQuery;
  const capture = {} as CaptureCandidatePort;
  const api = createCandidateManagementPublicApi({
    data: {} as FoundationScopedDataPort,
    query,
    capture,
  });

  assert.equal(api.query, query);
  assert.equal(api.capture, capture);
  assert.equal(Object.isFrozen(api), true);
});

test("公開入口は照会と取り込み作成の両契約がなければ組み立てを拒否する", () => {
  assert.throws(
    () =>
      createCandidateManagementPublicApi({
        data: {} as FoundationScopedDataPort,
        query: {} as CandidateQuery,
      } as CandidateManagementPublicDependencies),
    /query and capture/,
  );
});

test("取り込み公開portはURLと取得日時が未確定のdraftを受け渡せる", async () => {
  const input = {
    projectId: "10000000-0000-4000-8000-000000000001",
    category: "uncategorized",
    product: { name: { original: "架空の候補パーツ" } },
    normalizedAttributes: { category: "uncategorized" },
  } as CandidateDraft;
  let received: CandidateDraft | undefined;
  const capture: CaptureCandidatePort = {
    async createCandidate(draft) {
      received = draft;
      return { ok: false, error: { kind: "unsupported-data" } };
    },
  };
  const api = createCandidateManagementPublicApi({
    data: {} as FoundationScopedDataPort,
    query: {} as CandidateQuery,
    capture,
  });

  await api.capture.createCandidate(input);
  assert.equal(received, input);
  assert.equal(received?.sourceInfo, undefined);
});
