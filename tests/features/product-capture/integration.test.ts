import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { act } from "react";
import type { FeatureActivationError } from "../../../src/application-shell/public.js";
import type {
  CandidatePartId,
  ProjectId,
  Result,
  UtcTimestamp,
} from "../../../src/domain/public.js";
import { err, ok } from "../../../src/domain/public.js";
import type { LegacyCandidateEditorPrefill as CandidateEditorPrefill } from "../../../src/features/candidate-management/activation.js";
import type { CaptureCandidatePort } from "../../../src/features/candidate-management/contracts.js";

type CandidateDraft = Parameters<CaptureCandidatePort["createCandidate"]>[0];

import type {
  ActiveTabInfo,
  CaptureRuntimePort,
} from "../../../src/features/product-capture/coordinator.js";
import { createGenericExtractor } from "../../../src/features/product-capture/extractor.js";
import { createProductCaptureContribution } from "../../../src/features/product-capture/feature-contribution.js";
import type { CaptureProjectOption } from "../../../src/features/product-capture/view.js";
import { defaultMessageResolver } from "../../../src/ui-messages/public.js";

const extractor = createGenericExtractor();
const parse = (html: string): Document =>
  new DOMParser().parseFromString(html, "text/html");

const PROJECT_ID = "10000000-0000-4000-8000-000000000001" as ProjectId;
const PROJECTS: readonly CaptureProjectOption[] = [
  { id: PROJECT_ID, name: "架空プロジェクトA" },
];
const CAPTURED_AT = "2026-07-23T00:00:00Z" as UtcTimestamp;

const RICH_HTML = `<!doctype html><html><body>
  <script type="application/ld+json">${JSON.stringify({
    "@type": "Product",
    name: "架空CPU X100",
    brand: { name: "架空メーカー" },
    mpn: "X100-JP",
    offers: { price: "42800", priceCurrency: "JPY" },
  })}</script>
  <nav aria-label="breadcrumb"><ol><li>トップ</li><li>CPU</li></ol></nav>
</body></html>`;

const SPARSE_HTML = `<!doctype html><html><body>
  <h1>架空スパースCPU</h1>
</body></html>`;

interface Harness {
  readonly createdCandidates: CandidateDraft[];
  readonly editorCalls: CandidateEditorPrefill[];
  setPage(html: string, url: string): void;
  setEditorResult(result: Result<void, FeatureActivationError>): void;
  createContribution(): ReturnType<typeof createProductCaptureContribution>;
}

const harness = (): Harness => {
  let currentHtml = "<!doctype html><html><body></body></html>";
  let currentUrl = "https://shop.example.invalid/products/x100";
  const createdCandidates: CandidateDraft[] = [];
  const editorCalls: CandidateEditorPrefill[] = [];

  const runtime: CaptureRuntimePort = {
    async getActiveTab(): Promise<ActiveTabInfo | undefined> {
      return { tabId: 7, url: currentUrl };
    },
    async inject(target, requestId) {
      const document = parse(currentHtml);
      const candidates = extractor.extract(document, target.url);
      return ok({
        requestId,
        tabId: target.tabId,
        pageUrl: target.url,
        candidates,
      });
    },
  };

  const capture: CaptureCandidatePort = {
    async createCandidate(input) {
      createdCandidates.push(input);
      const id =
        `20000000-0000-4000-8000-00000000000${createdCandidates.length}` as CandidatePartId;
      return ok({
        id,
        ...input,
        createdAt: CAPTURED_AT,
        updatedAt: CAPTURED_AT,
      });
    },
  };

  let editorResult: Result<void, FeatureActivationError> = ok(undefined);
  const openCandidateEditor = async (
    prefill: CandidateEditorPrefill,
  ): Promise<Result<void, FeatureActivationError>> => {
    editorCalls.push(prefill);
    return editorResult;
  };

  return {
    createdCandidates,
    editorCalls,
    setPage(html, url) {
      currentHtml = html;
      currentUrl = url;
    },
    setEditorResult(result) {
      editorResult = result;
    },
    createContribution() {
      return createProductCaptureContribution(
        {
          data: {} as never,
          fullDataPort: {} as never,
          navigator: {} as never,
        },
        {
          runtime,
          capture,
          openCandidateEditor,
          listProjects: async () => PROJECTS,
        },
      );
    },
  };
};

async function mount(
  contribution: ReturnType<typeof createProductCaptureContribution>,
) {
  const container = document.createElement("div");
  let handle:
    | Awaited<ReturnType<typeof contribution.registration.mount>>
    | undefined;
  document.body.append(container);
  await act(async () => {
    handle = await contribution.registration.mount({
      container,
      operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
      reportError: () => {},
    });
  });
  return { container, handle };
}

function actionHandlerOf(
  contribution: ReturnType<typeof createProductCaptureContribution>,
): () => Promise<void> {
  const handlers = new Map<string, () => Promise<void>>();
  const result = contribution.workerRegistration?.register({
    addActionHandler(id, handler) {
      handlers.set(id, handler);
      return () => handlers.delete(id);
    },
    reportError: () => {},
  });
  assert.ok(result?.ok);
  const handler = [...handlers.values()][0];
  assert.ok(handler);
  return handler;
}

afterEach(cleanup);

test("情報が十分な架空ページはactionから保存完了まで一連の操作が成立する", async () => {
  const h = harness();
  h.setPage(RICH_HTML, "https://shop.example.invalid/products/x100");
  const contribution = h.createContribution();
  const { container } = await mount(contribution);
  const runAction = actionHandlerOf(contribution);

  await act(async () => {
    await runAction();
  });

  assert.match(container.textContent ?? "", /架空CPU X100/);

  const user = userEvent.setup();
  await user.selectOptions(
    container.querySelector("[data-capture-project-select]") as HTMLElement,
    PROJECT_ID,
  );
  await user.click(
    container.querySelector("[data-capture-submit]") as HTMLElement,
  );

  assert.match(
    container.textContent ?? "",
    new RegExp(
      defaultMessageResolver("capture.savedWithProject", {
        projectName: "架空プロジェクトA",
      }),
    ),
  );
  assert.equal(h.createdCandidates.length, 1);
  assert.equal(h.createdCandidates[0]?.category, "uncategorized");
  assert.equal(h.createdCandidates[0]?.product.name.confirmed, "架空CPU X100");
});

test("欠損のある架空ページも手入力で補って保存完了まで一連の操作が成立する", async () => {
  const h = harness();
  h.setPage(SPARSE_HTML, "https://shop.example.invalid/products/sparse");
  const contribution = h.createContribution();
  const { container } = await mount(contribution);
  const runAction = actionHandlerOf(contribution);

  await act(async () => {
    await runAction();
  });

  // 商品名だけが取得でき、他は欠損のまま保存できることを確認する。
  assert.match(container.textContent ?? "", /架空スパースCPU/);
  assert.match(
    container.textContent ?? "",
    new RegExp(defaultMessageResolver("capture.missingFieldStatus")),
  );

  const user = userEvent.setup();
  await user.selectOptions(
    container.querySelector("[data-capture-project-select]") as HTMLElement,
    PROJECT_ID,
  );
  await user.click(
    container.querySelector("[data-capture-submit]") as HTMLElement,
  );

  assert.match(
    container.textContent ?? "",
    new RegExp(
      defaultMessageResolver("capture.savedWithProject", {
        projectName: "架空プロジェクトA",
      }),
    ),
  );
  assert.equal(h.createdCandidates.length, 1);
  assert.equal(h.createdCandidates[0]?.product.manufacturer, undefined);
});

test("同じ架空sessionから詳細編集を選ぶと型付きprefillで開き、往復後も同じ修正値とproject選択が表示される", async () => {
  const h = harness();
  h.setPage(RICH_HTML, "https://shop.example.invalid/products/x100");
  const contribution = h.createContribution();
  const first = await mount(contribution);
  const runAction = actionHandlerOf(contribution);

  await act(async () => {
    await runAction();
  });

  const user = userEvent.setup();
  const nameInput = first.container.querySelector(
    "[data-capture-field='name']",
  ) as HTMLInputElement;
  await user.clear(nameInput);
  await user.type(nameInput, "手修正した名前");
  await user.selectOptions(
    first.container.querySelector(
      "[data-capture-project-select]",
    ) as HTMLElement,
    PROJECT_ID,
  );

  await user.click(
    first.container.querySelector(
      "[data-capture-open-detail-edit]",
    ) as HTMLElement,
  );

  assert.equal(h.editorCalls.length, 1);
  assert.equal(h.editorCalls[0]?.projectId, PROJECT_ID);
  assert.equal(
    h.editorCalls[0]?.draft.product.name.confirmed,
    "手修正した名前",
  );

  // シェルが候補管理画面へ切り替える動作を、capture側のunmountとして再現する。
  await act(async () => first.handle?.unmount());

  const second = await mount(contribution);

  const restoredNameInput = second.container.querySelector(
    "[data-capture-field='name']",
  ) as HTMLInputElement;
  assert.equal(restoredNameInput.value, "手修正した名前");
  const restoredSelect = second.container.querySelector(
    "[data-capture-project-select]",
  ) as HTMLSelectElement;
  assert.equal(restoredSelect.value, PROJECT_ID);
});

test("詳細編集への遷移がshell側で失敗すると確認画面に留まりエラーと入力値を表示する", async () => {
  const h = harness();
  h.setPage(RICH_HTML, "https://shop.example.invalid/products/x100");
  h.setEditorResult(
    err({ kind: "invalid_activation", detail: "架空の遷移失敗" }),
  );
  const contribution = h.createContribution();
  const { container } = await mount(contribution);
  const runAction = actionHandlerOf(contribution);

  await act(async () => {
    await runAction();
  });

  const user = userEvent.setup();
  await user.selectOptions(
    container.querySelector("[data-capture-project-select]") as HTMLElement,
    PROJECT_ID,
  );
  await user.click(
    container.querySelector("[data-capture-open-detail-edit]") as HTMLElement,
  );

  assert.equal(h.editorCalls.length, 1);
  await act(async () => {
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
  });

  assert.match(
    container.textContent ?? "",
    new RegExp(defaultMessageResolver("capture.errors.navigation")),
  );
  assert.match(container.textContent ?? "", /架空CPU X100/);
  assert.ok(container.querySelector("[data-capture-submit]"));
});
