import assert from "node:assert/strict";
import test from "node:test";
import type {
  CandidatePartId,
  ProjectId,
  RequestId,
  Result,
  UtcTimestamp,
} from "../../../src/domain/public.js";
import { err, ok } from "../../../src/domain/public.js";
import type {
  CaptureError,
  CaptureResult,
  ConfirmedCaptureSession,
} from "../../../src/features/product-capture/contracts.js";
import type { CaptureCoordinator } from "../../../src/features/product-capture/coordinator.js";
import {
  type CaptureStateDependencies,
  type CaptureSubmitOutcome,
  createCaptureState,
} from "../../../src/features/product-capture/state.js";

const REQUEST_ID = "80000000-0000-4000-8000-000000000001" as RequestId;
const CAPTURED_AT = "2026-07-23T00:00:00Z" as UtcTimestamp;
const PROJECT_ID = "10000000-0000-4000-8000-000000000001" as ProjectId;
const OTHER_PROJECT_ID = "10000000-0000-4000-8000-000000000002" as ProjectId;
const CANDIDATE_ID = "20000000-0000-4000-8000-000000000001" as CandidatePartId;

const captureResult = (
  overrides: Partial<CaptureResult> = {},
): CaptureResult => ({
  requestId: REQUEST_ID,
  tabId: 7,
  pageUrl: "https://shop.example.invalid/products/x100",
  capturedAt: CAPTURED_AT,
  draft: {
    fields: [
      {
        field: "name",
        normalizedValue: "架空CPU X100",
        rawValue: " 架空CPU X100 ",
        source: "json-ld",
        sourceLabel: "JSON-LD name",
      },
    ],
    missingCoreFields: [
      "category",
      "manufacturer",
      "modelNumber",
      "price",
      "url",
    ],
  },
  rejectedFields: [],
  ...overrides,
});

interface Harness {
  readonly dependencies: CaptureStateDependencies;
  readonly submitCalls: ConfirmedCaptureSession[];
  setCaptureResult(result: Result<CaptureResult, CaptureError>): void;
  setSubmitResult(result: Result<CaptureSubmitOutcome, CaptureError>): void;
}

const harness = (): Harness => {
  let nextCaptureResult: Result<CaptureResult, CaptureError> = ok(
    captureResult(),
  );
  let nextSubmitResult: Result<CaptureSubmitOutcome, CaptureError> = ok({
    candidateId: CANDIDATE_ID,
    projectId: PROJECT_ID,
  });
  const submitCalls: ConfirmedCaptureSession[] = [];

  const coordinator: CaptureCoordinator = {
    async captureCurrentTab() {
      return nextCaptureResult;
    },
  };

  return {
    dependencies: {
      coordinator,
      async submitDraft(session) {
        submitCalls.push(session);
        return nextSubmitResult;
      },
    },
    submitCalls,
    setCaptureResult(result) {
      nextCaptureResult = result;
    },
    setSubmitResult(result) {
      nextSubmitResult = result;
    },
  };
};

test("初期状態はidleである", () => {
  const h = harness();
  const state = createCaptureState(h.dependencies);
  assert.deepEqual(state.value, { status: "idle" });
});

test("取り込みに成功すると採用値・欠損・棄却理由を保持したreviewへ遷移する", async () => {
  const h = harness();
  h.setCaptureResult(
    ok(
      captureResult({
        rejectedFields: [{ field: "price", reason: "unresolvable" }],
      }),
    ),
  );
  const state = createCaptureState(h.dependencies);

  await state.startCapture();

  assert.equal(state.value.status, "review");
  if (state.value.status !== "review") return;
  const session = state.value.session;
  assert.equal(session.fields.length, 1);
  assert.deepEqual(session.fields[0]?.value, {
    original: " 架空CPU X100 ",
    confirmed: "架空CPU X100",
  });
  assert.deepEqual(session.rejectedFields, [
    { field: "price", reason: "unresolvable" },
  ]);
  assert.ok(session.missingCoreFields.includes("category"));
  assert.deepEqual(session.userCorrections, {});
  assert.equal(session.projectId, undefined);
});

test("取り込みに失敗するとdraftなしのfailedへ遷移する", async () => {
  const h = harness();
  h.setCaptureResult(err({ kind: "restricted-page" }));
  const state = createCaptureState(h.dependencies);

  await state.startCapture();

  assert.deepEqual(state.value, {
    status: "failed",
    recoverable: true,
    error: { kind: "restricted-page" },
  });
});

test("再実行は現在表示中のページを新しい取り込み対象として再取得する", async () => {
  const h = harness();
  h.setCaptureResult(err({ kind: "injection-failed" }));
  const state = createCaptureState(h.dependencies);
  await state.startCapture();
  assert.equal(state.value.status, "failed");

  h.setCaptureResult(ok(captureResult()));
  await state.startCapture();

  assert.equal(state.value.status, "review");
});

test("修正値は元表記と区別してuserCorrectionsへ保持される", async () => {
  const h = harness();
  const state = createCaptureState(h.dependencies);
  await state.startCapture();

  state.updateField("name", "手修正した名前");

  assert.equal(state.value.status, "review");
  if (state.value.status !== "review") return;
  assert.equal(state.value.session.userCorrections.name, "手修正した名前");
  assert.deepEqual(state.value.session.fields[0]?.value, {
    original: " 架空CPU X100 ",
    confirmed: "架空CPU X100",
  });
});

test("review以外では修正やproject選択を無視する", () => {
  const h = harness();
  const state = createCaptureState(h.dependencies);

  state.updateField("name", "無視されるはず");
  state.selectProject(PROJECT_ID);

  assert.deepEqual(state.value, { status: "idle" });
});

test("reportDetailEditFailureはreview中のセッションを保持したままnavigationエラーのfailedへ遷移する", async () => {
  const h = harness();
  const state = createCaptureState(h.dependencies);
  await state.startCapture();
  state.selectProject(PROJECT_ID);

  state.reportDetailEditFailure({ kind: "navigation" });

  assert.equal(state.value.status, "failed");
  if (state.value.status !== "failed") return;
  assert.deepEqual(state.value.error, { kind: "navigation" });
  assert.equal(state.value.draft?.projectId, PROJECT_ID);
});

test("reportDetailEditFailureはdraftを保持したfailedからも同じdraftを保ってエラーを差し替える", async () => {
  const h = harness();
  const state = createCaptureState(h.dependencies);
  await state.startCapture();
  state.updateField("name", "");
  await state.submit();
  assert.equal(state.value.status, "failed");

  state.reportDetailEditFailure({ kind: "navigation" });

  assert.equal(state.value.status, "failed");
  if (state.value.status !== "failed") return;
  assert.deepEqual(state.value.error, { kind: "navigation" });
  assert.equal(state.value.draft?.userCorrections.name, "");
});

test("activeなセッションがない状態でのreportDetailEditFailureは無視される", () => {
  const h = harness();
  const state = createCaptureState(h.dependencies);

  state.reportDetailEditFailure({ kind: "navigation" });

  assert.deepEqual(state.value, { status: "idle" });
});

test("projectを選択できる", async () => {
  const h = harness();
  const state = createCaptureState(h.dependencies);
  await state.startCapture();

  state.selectProject(PROJECT_ID);

  assert.equal(state.value.status, "review");
  if (state.value.status !== "review") return;
  assert.equal(state.value.session.projectId, PROJECT_ID);
});

test("商品名が空のまま保存すると対象項目を示すfailedへ遷移し入力を保持する", async () => {
  const h = harness();
  h.setCaptureResult(
    ok(
      captureResult({
        draft: {
          fields: [],
          missingCoreFields: [
            "name",
            "category",
            "manufacturer",
            "modelNumber",
            "price",
            "url",
          ],
        },
      }),
    ),
  );
  const state = createCaptureState(h.dependencies);
  await state.startCapture();
  state.selectProject(PROJECT_ID);

  await state.submit();

  assert.equal(state.value.status, "failed");
  if (state.value.status !== "failed") return;
  assert.deepEqual(state.value.error, {
    kind: "validation",
    fields: { name: "required" },
  });
  assert.equal(state.value.recoverable, true);
  assert.equal(state.value.draft?.projectId, PROJECT_ID);
  assert.equal(h.submitCalls.length, 0);
});

test("projectを選択せずに保存するとproject-requiredのfailedへ遷移する", async () => {
  const h = harness();
  const state = createCaptureState(h.dependencies);
  await state.startCapture();

  await state.submit();

  assert.equal(state.value.status, "failed");
  if (state.value.status !== "failed") return;
  assert.deepEqual(state.value.error, { kind: "project-required" });
  assert.equal(h.submitCalls.length, 0);
});

test("有効な商品名とprojectで保存に成功するとsavedへ遷移する", async () => {
  const h = harness();
  h.setSubmitResult(
    ok({ candidateId: CANDIDATE_ID, projectId: OTHER_PROJECT_ID }),
  );
  const state = createCaptureState(h.dependencies);
  await state.startCapture();
  state.selectProject(PROJECT_ID);

  await state.submit();

  assert.deepEqual(state.value, {
    status: "saved",
    candidateId: CANDIDATE_ID,
    projectId: OTHER_PROJECT_ID,
  });
  assert.equal(h.submitCalls.length, 1);
  assert.equal(h.submitCalls[0]?.projectId, PROJECT_ID);
});

test("保存が失敗すると抽出結果・修正値・project選択を保持したfailedへ遷移する", async () => {
  const h = harness();
  h.setSubmitResult(err({ kind: "storage" }));
  const state = createCaptureState(h.dependencies);
  await state.startCapture();
  state.selectProject(PROJECT_ID);
  state.updateField("manufacturer", "手修正メーカー");

  await state.submit();

  assert.equal(state.value.status, "failed");
  if (state.value.status !== "failed") return;
  assert.deepEqual(state.value.error, { kind: "storage" });
  assert.equal(state.value.recoverable, true);
  assert.equal(state.value.draft?.projectId, PROJECT_ID);
  assert.equal(
    state.value.draft?.userCorrections.manufacturer,
    "手修正メーカー",
  );
});

test("保存失敗後に再編集して再送すると同じセッションを引き継いで保存できる", async () => {
  const h = harness();
  h.setSubmitResult(err({ kind: "storage" }));
  const state = createCaptureState(h.dependencies);
  await state.startCapture();
  state.selectProject(PROJECT_ID);
  await state.submit();
  const afterFirstSubmit = state.value;
  assert.equal(afterFirstSubmit.status, "failed");

  h.setSubmitResult(ok({ candidateId: CANDIDATE_ID, projectId: PROJECT_ID }));
  state.updateField("name", "再送前に修正");
  const afterEdit = state.value;
  assert.equal(afterEdit.status, "review");

  await state.submit();

  const afterSecondSubmit = state.value;
  assert.equal(afterSecondSubmit.status, "saved");
  assert.equal(h.submitCalls.length, 2);
  assert.equal(h.submitCalls[1]?.userCorrections.name, "再送前に修正");
});

test("draftのないfailedでは修正や保存要求を無視する", async () => {
  const h = harness();
  h.setCaptureResult(err({ kind: "no-candidate" }));
  const state = createCaptureState(h.dependencies);
  await state.startCapture();
  assert.equal(state.value.status, "failed");

  state.updateField("name", "無視されるはず");
  await state.submit();

  assert.deepEqual(state.value, {
    status: "failed",
    recoverable: true,
    error: { kind: "no-candidate" },
  });
  assert.equal(h.submitCalls.length, 0);
});

test("保存処理中の再送は拒否され同一セッションから一度だけ保存要求が発生する", async () => {
  const h = harness();
  let resolveSubmit: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    resolveSubmit = resolve;
  });
  const dependencies: CaptureStateDependencies = {
    coordinator: h.dependencies.coordinator,
    async submitDraft(session) {
      h.submitCalls.push(session);
      await pending;
      return ok({ candidateId: CANDIDATE_ID, projectId: PROJECT_ID });
    },
  };
  const state = createCaptureState(dependencies);
  await state.startCapture();
  state.selectProject(PROJECT_ID);

  const first = state.submit();
  assert.equal(state.value.status, "submitting");
  const second = state.submit();

  resolveSubmit?.();
  await Promise.all([first, second]);

  assert.equal(h.submitCalls.length, 1);
  assert.equal(state.value.status, "saved");
});

test("カテゴリが欠損していても値を推測せずmissingCoreFieldsのまま保持する", async () => {
  const h = harness();
  const state = createCaptureState(h.dependencies);
  await state.startCapture();

  assert.equal(state.value.status, "review");
  if (state.value.status !== "review") return;
  assert.equal(
    state.value.session.fields.some((field) => field.field === "category"),
    false,
  );
  assert.ok(state.value.session.missingCoreFields.includes("category"));
});

test("取り込み中に依存先が例外を投げても永続状態を変更せず再試行できるfailedへ遷移する", async () => {
  const coordinator: CaptureCoordinator = {
    async captureCurrentTab() {
      throw new Error("unexpected");
    },
  };
  const state = createCaptureState({
    coordinator,
    async submitDraft() {
      throw new Error("unreachable");
    },
  });

  await state.startCapture();

  assert.deepEqual(state.value, {
    status: "failed",
    recoverable: true,
    error: { kind: "injection-failed" },
  });

  const h = harness();
  const recovered = createCaptureState({
    coordinator: h.dependencies.coordinator,
    submitDraft: h.dependencies.submitDraft,
  });
  await recovered.startCapture();
  await recovered.startCapture();
  assert.equal(recovered.value.status, "review");
});

test("保存中に依存先が例外を投げても抽出結果と修正値を保持したfailedへ遷移し再送できる", async () => {
  const h = harness();
  let shouldThrow = true;
  const dependencies: CaptureStateDependencies = {
    coordinator: h.dependencies.coordinator,
    async submitDraft(session) {
      if (shouldThrow) {
        shouldThrow = false;
        throw new Error("unexpected");
      }
      h.submitCalls.push(session);
      return ok({ candidateId: CANDIDATE_ID, projectId: PROJECT_ID });
    },
  };
  const state = createCaptureState(dependencies);
  await state.startCapture();
  state.selectProject(PROJECT_ID);
  state.updateField("name", "例外前の修正");

  await state.submit();

  assert.equal(state.value.status, "failed");
  if (state.value.status !== "failed") return;
  assert.deepEqual(state.value.error, { kind: "storage" });
  assert.equal(state.value.recoverable, true);
  assert.equal(state.value.draft?.userCorrections.name, "例外前の修正");
  assert.equal(state.value.draft?.projectId, PROJECT_ID);

  await state.submit();

  assert.equal(state.value.status, "saved");
  assert.equal(h.submitCalls.length, 1);
});
