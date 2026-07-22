import assert from "node:assert/strict";
import test from "node:test";

import type {
  CandidatePart,
  ProjectId,
  Uuid,
} from "../../../src/domain/public.js";
import type {
  CandidateDraft,
  CandidateQuery,
  CaptureCandidatePort,
} from "../../../src/features/candidate-management/contracts.js";
import { createCandidateManagementPublicApi } from "../../../src/features/candidate-management/public.js";
import type { FoundationDataPort } from "../../../src/persistence/public.js";

const projectId = "10000000-0000-4000-8000-000000000071" as Uuid as ProjectId;
const draft = {
  projectId,
  category: "uncategorized",
  product: { name: { original: "架空の取り込み候補" } },
  normalizedAttributes: { category: "uncategorized" },
} satisfies CandidateDraft;

test("公開入口は取り込み側の欠損候補作成と構成管理側の分類済み候補照会をそのまま提供する", async () => {
  const captured: CandidateDraft[] = [];
  const eligible = [
    { id: "30000000-0000-4000-8000-000000000071" },
  ] as CandidatePart[];
  const capturedCandidate = eligible[0];
  if (capturedCandidate === undefined)
    throw new Error("架空の分類済み候補がありません");
  const query = {
    async listProjects() {
      return { ok: true as const, value: [] };
    },
    async listCandidates() {
      return { ok: true as const, value: [] };
    },
    async listBuildEligible(receivedProjectId: ProjectId) {
      assert.equal(receivedProjectId, projectId);
      return { ok: true as const, value: eligible };
    },
  } satisfies CandidateQuery;
  const capture = {
    async createCandidate(input: CandidateDraft) {
      captured.push(input);
      return { ok: true as const, value: capturedCandidate };
    },
  } satisfies CaptureCandidatePort;
  const api = createCandidateManagementPublicApi({
    data: {} as FoundationDataPort,
    query,
    capture,
  });

  assert.deepEqual(await api.capture.createCandidate(draft), {
    ok: true,
    value: capturedCandidate,
  });
  assert.deepEqual(captured, [draft]);
  assert.deepEqual(await api.query.listBuildEligible(projectId), {
    ok: true,
    value: eligible,
  });
});
