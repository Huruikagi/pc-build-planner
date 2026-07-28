import assert from "node:assert/strict";
import test from "node:test";
import type {
  CandidatePart,
  CandidatePartId,
  ProjectId,
  RequestId,
  Result,
  UtcTimestamp,
} from "../../../src/domain/public.js";
import { err, ok } from "../../../src/domain/public.js";
import type {
  CandidateDraft,
  ManagementError,
} from "../../../src/features/candidate-management/public.js";
import type {
  CaptureError,
  ConfirmedCaptureSession,
} from "../../../src/features/product-capture/contracts.js";
import type { CaptureDraftMapper } from "../../../src/features/product-capture/draft-mapper.js";
import { createSubmitCaptureDraft } from "../../../src/features/product-capture/submit-draft.js";

const REQUEST_ID = "80000000-0000-4000-8000-000000000001" as RequestId;
const CAPTURED_AT = "2026-07-23T00:00:00Z" as UtcTimestamp;
const PROJECT_ID = "10000000-0000-4000-8000-000000000001" as ProjectId;
const CANDIDATE_ID = "20000000-0000-4000-8000-000000000001" as CandidatePartId;

const session = (): ConfirmedCaptureSession => ({
  requestId: REQUEST_ID,
  tabId: 7,
  pageUrl: "https://shop.example.invalid/products/x100",
  capturedAt: CAPTURED_AT,
  fields: [
    {
      field: "name",
      value: { original: "架空CPU X100", confirmed: "架空CPU X100" },
      source: "json-ld",
      sourceLabel: "JSON-LD name",
    },
  ],
  rejectedFields: [],
  missingCoreFields: [
    "category",
    "manufacturer",
    "modelNumber",
    "price",
    "url",
  ],
  userCorrections: {},
  projectId: PROJECT_ID,
});

const draft: CandidateDraft = {
  projectId: PROJECT_ID,
  category: "uncategorized",
  product: { name: { original: "架空CPU X100", confirmed: "架空CPU X100" } },
  sources: [],
  normalizedAttributes: { category: "uncategorized" },
};

const candidatePart: CandidatePart = {
  id: CANDIDATE_ID,
  projectId: PROJECT_ID,
  category: "uncategorized",
  product: { name: { original: "架空CPU X100", confirmed: "架空CPU X100" } },
  normalizedAttributes: { category: "uncategorized" },
  createdAt: CAPTURED_AT,
  updatedAt: CAPTURED_AT,
};

interface Harness {
  readonly mapperCalls: ConfirmedCaptureSession[];
  readonly createCalls: CandidateDraft[];
  setMapperResult(result: Result<CandidateDraft, CaptureError>): void;
  setCreateResult(result: Result<CandidatePart, ManagementError>): void;
  readonly draftMapper: CaptureDraftMapper;
  readonly capturePort: {
    createCandidate(
      input: CandidateDraft,
    ): Promise<Result<CandidatePart, ManagementError>>;
  };
}

const harness = (): Harness => {
  const mapperCalls: ConfirmedCaptureSession[] = [];
  const createCalls: CandidateDraft[] = [];
  let mapperResult: Result<CandidateDraft, CaptureError> = ok(draft);
  let createResult: Result<CandidatePart, ManagementError> = ok(candidatePart);

  return {
    mapperCalls,
    createCalls,
    setMapperResult(result) {
      mapperResult = result;
    },
    setCreateResult(result) {
      createResult = result;
    },
    draftMapper: {
      toCandidateDraft(input) {
        mapperCalls.push(input);
        return mapperResult;
      },
    },
    capturePort: {
      async createCandidate(input) {
        createCalls.push(input);
        return createResult;
      },
    },
  };
};

test("有効なセッションはdraftMapperで変換した内容を一度だけcreateCandidateへ渡す", async () => {
  const h = harness();
  const submit = createSubmitCaptureDraft({
    draftMapper: h.draftMapper,
    capturePort: h.capturePort,
  });

  const result = await submit(session());

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.candidateId, CANDIDATE_ID);
  assert.equal(result.value.projectId, PROJECT_ID);
  assert.equal(h.mapperCalls.length, 1);
  assert.equal(h.createCalls.length, 1);
  assert.deepEqual(h.createCalls[0], draft);
});

test("未分類の候補も上流規則どおりそのまま保存される", async () => {
  const h = harness();
  const submit = createSubmitCaptureDraft({
    draftMapper: h.draftMapper,
    capturePort: h.capturePort,
  });

  await submit(session());

  assert.equal(h.createCalls[0]?.category, "uncategorized");
});

test("draftMapperが失敗した場合はcreateCandidateを呼ばず同じエラーを返す", async () => {
  const h = harness();
  h.setMapperResult(err({ kind: "validation", fields: { name: "required" } }));
  const submit = createSubmitCaptureDraft({
    draftMapper: h.draftMapper,
    capturePort: h.capturePort,
  });

  const result = await submit(session());

  assert.deepEqual(result, {
    ok: false,
    error: { kind: "validation", fields: { name: "required" } },
  });
  assert.equal(h.createCalls.length, 0);
});

const managementErrorCases: ReadonlyArray<
  readonly [ManagementError, CaptureError]
> = [
  [
    { kind: "validation", fields: { name: "invalid" } },
    { kind: "validation", fields: { name: "invalid" } },
  ],
  [{ kind: "maintenance" }, { kind: "maintenance" }],
  [{ kind: "storage" }, { kind: "storage" }],
  [{ kind: "quota" }, { kind: "quota" }],
  [{ kind: "unsupported-data" }, { kind: "unsupported-data" }],
  [{ kind: "conflict" }, { kind: "storage" }],
  [{ kind: "not-found", entity: "project" }, { kind: "storage" }],
];

for (const [managementError, expectedCaptureError] of managementErrorCases) {
  test(`候補作成ポートの${managementError.kind}失敗を識別可能なCaptureErrorへ変換する`, async () => {
    const h = harness();
    h.setCreateResult(err(managementError));
    const submit = createSubmitCaptureDraft({
      draftMapper: h.draftMapper,
      capturePort: h.capturePort,
    });

    const result = await submit(session());

    assert.deepEqual(result, { ok: false, error: expectedCaptureError });
  });
}

test("candidate作成ポートが例外を投げても永続状態を偽らず識別可能な失敗を返す", async () => {
  const h = harness();
  const submit = createSubmitCaptureDraft({
    draftMapper: h.draftMapper,
    capturePort: {
      async createCandidate() {
        throw new Error("unexpected");
      },
    },
  });

  const result = await submit(session());

  assert.deepEqual(result, { ok: false, error: { kind: "storage" } });
});
