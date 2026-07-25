import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup, render } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
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
} from "../../../src/features/product-capture/contracts.js";
import type { CaptureCoordinator } from "../../../src/features/product-capture/coordinator.js";
import {
  type CaptureState,
  type CaptureSubmitOutcome,
  createCaptureState,
} from "../../../src/features/product-capture/state.js";
import {
  type CaptureProjectOption,
  CaptureView,
} from "../../../src/features/product-capture/view.js";
import { defaultMessageResolver } from "../../../src/ui-messages/public.js";

const REQUEST_ID = "80000000-0000-4000-8000-000000000001" as RequestId;
const CAPTURED_AT = "2026-07-23T00:00:00Z" as UtcTimestamp;
const PROJECT_ID = "10000000-0000-4000-8000-000000000001" as ProjectId;
const CANDIDATE_ID = "20000000-0000-4000-8000-000000000001" as CandidatePartId;
const PROJECTS: readonly CaptureProjectOption[] = [
  { id: PROJECT_ID, name: "架空プロジェクトA" },
];

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
  readonly state: CaptureState;
  readonly submitCalls: number;
  setCaptureResult(result: Result<CaptureResult, CaptureError>): void;
  setSubmitResult(result: Result<CaptureSubmitOutcome, CaptureError>): void;
}

const createHarness = (): Harness => {
  let nextCaptureResult: Result<CaptureResult, CaptureError> = ok(
    captureResult(),
  );
  let nextSubmitResult: Result<CaptureSubmitOutcome, CaptureError> = ok({
    candidateId: CANDIDATE_ID,
    projectId: PROJECT_ID,
  });
  let submitCalls = 0;

  const coordinator: CaptureCoordinator = {
    async captureCurrentTab() {
      return nextCaptureResult;
    },
  };

  const state = createCaptureState({
    coordinator,
    async submitDraft() {
      submitCalls += 1;
      return nextSubmitResult;
    },
  });

  return {
    state,
    get submitCalls() {
      return submitCalls;
    },
    setCaptureResult(result) {
      nextCaptureResult = result;
    },
    setSubmitResult(result) {
      nextSubmitResult = result;
    },
  };
};

async function renderView(
  harness: Harness,
  onOpenDetailEdit?: (manualName?: string) => void,
) {
  const user = userEvent.setup();
  const view = render(
    <CaptureView
      projects={PROJECTS}
      state={harness.state}
      {...(onOpenDetailEdit === undefined ? {} : { onOpenDetailEdit })}
    />,
  );
  const query = <E extends Element = HTMLElement>(selector: string): E => {
    const element = view.container.querySelector<E>(selector);
    assert.ok(element, `expected element for selector ${selector}`);
    return element;
  };
  return {
    ...view,
    user,
    query,
    text: () => view.container.textContent ?? "",
  };
}

afterEach(cleanup);

test("idle状態は取り込み開始の案内とボタンを表示する", async () => {
  const harness = createHarness();
  const rendered = await renderView(harness);

  assert.match(
    rendered.text(),
    new RegExp(defaultMessageResolver("capture.startAction")),
  );

  await rendered.user.click(rendered.query("[data-capture-start]"));
  assert.ok(rendered.query("[data-capture-field='name']"));
});

test("抽出中は取り込み中である旨を表示する", async () => {
  const pending = new Promise<never>(() => {
    // Never resolves, so the assertion observes the state while still "extracting".
  });
  const coordinator: CaptureCoordinator = {
    captureCurrentTab: () => pending,
  };
  const state = createCaptureState({
    coordinator,
    async submitDraft() {
      throw new Error("unreachable");
    },
  });
  void state.startCapture();
  const rendered = render(<CaptureView projects={PROJECTS} state={state} />);

  assert.match(
    rendered.container.textContent ?? "",
    new RegExp(defaultMessageResolver("capture.extractingStatus")),
  );
});

test("reviewでは項目・取得元・元表記・欠損を表示し値を修正できる", async () => {
  const harness = createHarness();
  await harness.state.startCapture();
  const rendered = await renderView(harness);

  assert.match(rendered.text(), /架空CPU X100/);
  assert.match(
    rendered.text(),
    new RegExp(
      defaultMessageResolver("capture.sourceAttribution", {
        source: defaultMessageResolver("capture.sources.json-ld"),
        sourceLabel: "JSON-LD name",
      }),
    ),
  );
  assert.match(
    rendered.text(),
    new RegExp(
      defaultMessageResolver("capture.originalValueLabel", {
        value: " 架空CPU X100 ",
      }),
    ),
  );
  assert.match(
    rendered.text(),
    new RegExp(defaultMessageResolver("capture.missingFieldStatus")),
  );

  const nameInput = rendered.query<HTMLInputElement>(
    "[data-capture-field='name']",
  );
  await rendered.user.clear(nameInput);
  await rendered.user.type(nameInput, "手修正した名前");

  assert.equal(
    harness.state.value.status === "review" &&
      harness.state.value.session.userCorrections.name,
    "手修正した名前",
  );
});

test("カテゴリ行は入力欄ではなく推定と取得根拠を読み取り専用で表示する", async () => {
  const harness = createHarness();
  harness.setCaptureResult(
    ok(
      captureResult({
        draft: {
          fields: [
            {
              field: "name",
              normalizedValue: "架空GPU",
              rawValue: "架空GPU",
              source: "json-ld",
              sourceLabel: "JSON-LD name",
            },
            {
              field: "category",
              normalizedValue: "グラフィックボード",
              rawValue: "グラフィックボード",
              source: "breadcrumb",
              sourceLabel: "breadcrumb category segment",
            },
          ],
          missingCoreFields: ["manufacturer", "modelNumber", "price", "url"],
        },
      }),
    ),
  );
  await harness.state.startCapture();
  const rendered = await renderView(harness);

  assert.equal(
    rendered.container.querySelector("[data-capture-field='category']"),
    null,
  );
  const hint = rendered.query("[data-capture-category-hint]");
  assert.match(
    hint.textContent ?? "",
    new RegExp(
      defaultMessageResolver("capture.categoryHintEstimated", {
        label: defaultMessageResolver("category.gpu"),
      }),
    ),
  );
  assert.match(
    rendered.text(),
    new RegExp(
      defaultMessageResolver("capture.originalValueLabel", {
        value: "グラフィックボード",
      }),
    ),
  );
});

test("商品名が空の間は保存と詳細編集を無効化し入力すると有効化する", async () => {
  const harness = createHarness();
  await harness.state.startCapture();
  harness.state.updateField("name", "");
  const rendered = await renderView(harness);

  assert.equal(
    rendered.query<HTMLButtonElement>("[data-capture-submit]").disabled,
    true,
  );
  assert.equal(
    rendered.query<HTMLButtonElement>("[data-capture-open-detail-edit]")
      .disabled,
    true,
  );

  const nameInput = rendered.query<HTMLInputElement>(
    "[data-capture-field='name']",
  );
  await rendered.user.type(nameInput, "架空品");

  assert.equal(
    rendered.query<HTMLButtonElement>("[data-capture-submit]").disabled,
    false,
  );
  assert.equal(
    rendered.query<HTMLButtonElement>("[data-capture-open-detail-edit]")
      .disabled,
    false,
  );
});

test("projectを選択し保存を押すとsubmitへ進み保存完了を表示する", async () => {
  const harness = createHarness();
  await harness.state.startCapture();
  const rendered = await renderView(harness);

  await rendered.user.selectOptions(
    rendered.query<HTMLSelectElement>("[data-capture-project-select]"),
    PROJECT_ID,
  );
  await rendered.user.click(rendered.query("[data-capture-submit]"));

  assert.match(
    rendered.text(),
    new RegExp(
      defaultMessageResolver("capture.savedWithProject", {
        projectName: "架空プロジェクトA",
      }),
    ),
  );
});

test("詳細編集ボタンはonOpenDetailEditを呼び出す", async () => {
  const harness = createHarness();
  await harness.state.startCapture();
  let called = 0;
  const rendered = await renderView(harness, () => {
    called += 1;
  });

  await rendered.user.click(rendered.query("[data-capture-open-detail-edit]"));

  assert.equal(called, 1);
});

test("取り込み失敗(draftなし)は再実行導線を表示する", async () => {
  const harness = createHarness();
  harness.setCaptureResult(err({ kind: "restricted-page" }));
  await harness.state.startCapture();
  const rendered = await renderView(harness);

  assert.match(
    rendered.text(),
    new RegExp(defaultMessageResolver("capture.errors.restricted-page")),
  );
  assert.ok(rendered.query("[data-capture-retry]"));
});

test("抽出候補ゼロは手入力での案内を表示し商品名入力で詳細編集を有効化する", async () => {
  const harness = createHarness();
  harness.setCaptureResult(err({ kind: "no-candidate" }));
  await harness.state.startCapture();
  let receivedName: string | undefined;
  const rendered = await renderView(harness, (manualName) => {
    receivedName = manualName;
  });

  assert.match(
    rendered.text(),
    new RegExp(defaultMessageResolver("capture.errors.no-candidate")),
  );
  const button = rendered.query<HTMLButtonElement>(
    "[data-capture-open-detail-edit]",
  );
  assert.equal(button.disabled, true);

  await rendered.user.type(
    rendered.query("[data-capture-manual-name]"),
    "架空手入力品",
  );
  assert.equal(button.disabled, false);
  await rendered.user.click(button);

  assert.equal(receivedName, "架空手入力品");
});

test("保存失敗はdraftを保持したreview相当の画面とエラーを表示する", async () => {
  const harness = createHarness();
  await harness.state.startCapture();
  harness.state.selectProject(PROJECT_ID);
  harness.setSubmitResult(err({ kind: "storage" }));
  await harness.state.submit();
  const rendered = await renderView(harness);

  assert.match(
    rendered.text(),
    new RegExp(defaultMessageResolver("capture.errors.storage")),
  );
  assert.match(rendered.text(), /架空CPU X100/);
  assert.ok(rendered.query("[data-capture-submit]"));
});

test("未信頼な元表記を安全なtextとして描画しHTMLとして解釈しない", async () => {
  const harness = createHarness();
  harness.setCaptureResult(
    ok(
      captureResult({
        draft: {
          fields: [
            {
              field: "name",
              normalizedValue: "<img src=x onerror=alert(1)>",
              rawValue: "<img src=x onerror=alert(1)>",
              source: "heading",
              sourceLabel: "h1",
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
      }),
    ),
  );
  await harness.state.startCapture();
  const rendered = await renderView(harness);

  assert.equal(rendered.container.querySelector("img"), null);
  assert.equal(
    rendered.query<HTMLInputElement>("[data-capture-field='name']").value,
    "<img src=x onerror=alert(1)>",
  );
});
