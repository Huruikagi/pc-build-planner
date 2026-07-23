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
import type {
  CandidateDraft,
  CandidateEditorPrefill,
  CaptureCandidatePort,
  ManagementError,
} from "../../../src/features/candidate-management/public.js";
import type {
  ActiveTabInfo,
  CaptureRuntimePort,
} from "../../../src/features/product-capture/coordinator.js";
import { createGenericExtractor } from "../../../src/features/product-capture/extractor.js";
import { createProductCaptureContribution } from "../../../src/features/product-capture/feature-contribution.js";
import type { CaptureProjectOption } from "../../../src/features/product-capture/view.js";

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
    offers: { price: "42800", priceCurrency: "JPY" },
  })}</script>
</body></html>`;

interface Harness {
  readonly injectCalls: number;
  readonly createCandidateCalls: CandidateDraft[];
  readonly consoleCalls: readonly unknown[][];
  readonly editorCalls: CandidateEditorPrefill[];
  setActiveTab(tab: ActiveTabInfo | undefined): void;
  setPage(html: string): void;
  setCreateResult(result: Result<unknown, ManagementError>): void;
  holdCreateCandidate(): { release: () => void };
  createContribution(): ReturnType<typeof createProductCaptureContribution>;
  restoreConsole(): void;
}

const harness = (): Harness => {
  let activeTab: ActiveTabInfo | undefined = {
    tabId: 7,
    url: "https://shop.example.invalid/products/x100",
  };
  let currentHtml = RICH_HTML;
  let createResult: Result<unknown, ManagementError> = ok({});
  let injectCalls = 0;
  const createCandidateCalls: CandidateDraft[] = [];
  const consoleCalls: unknown[][] = [];
  const editorCalls: CandidateEditorPrefill[] = [];
  let holdActive = false;
  const pendingResolvers: Array<() => void> = [];

  const originalConsole: Record<"log" | "warn" | "error", typeof console.log> =
    {
      log: console.log,
      warn: console.warn,
      error: console.error,
    };
  for (const method of ["log", "warn", "error"] as const) {
    const original = originalConsole[method];
    console[method] = (...args: unknown[]) => {
      consoleCalls.push(args);
      return original.apply(console, args);
    };
  }

  const runtime: CaptureRuntimePort = {
    async getActiveTab() {
      return activeTab;
    },
    async inject(target, requestId) {
      injectCalls += 1;
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
      createCandidateCalls.push(input);
      if (holdActive) {
        await new Promise<void>((resolve) => {
          pendingResolvers.push(resolve);
        });
      }
      if (!createResult.ok)
        return createResult as Result<never, ManagementError>;
      const id =
        `20000000-0000-4000-8000-00000000000${createCandidateCalls.length}` as CandidatePartId;
      return ok({
        id,
        ...input,
        createdAt: CAPTURED_AT,
        updatedAt: CAPTURED_AT,
      });
    },
  };

  const openCandidateEditor = async (
    prefill: CandidateEditorPrefill,
  ): Promise<Result<void, FeatureActivationError>> => {
    editorCalls.push(prefill);
    return ok(undefined);
  };

  return {
    get injectCalls() {
      return injectCalls;
    },
    createCandidateCalls,
    consoleCalls,
    editorCalls,
    restoreConsole() {
      console.log = originalConsole.log;
      console.warn = originalConsole.warn;
      console.error = originalConsole.error;
    },
    setActiveTab(tab) {
      activeTab = tab;
    },
    setPage(html) {
      currentHtml = html;
    },
    setCreateResult(result) {
      createResult = result;
    },
    holdCreateCandidate() {
      holdActive = true;
      return {
        release() {
          holdActive = false;
          for (const resolve of pendingResolvers.splice(0)) resolve();
        },
      };
    },
    createContribution() {
      return createProductCaptureContribution(
        { data: {} as never, navigator: {} as never },
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
  document.body.append(container);
  let handle:
    | Awaited<ReturnType<typeof contribution.registration.mount>>
    | undefined;
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

let activeHarness: Harness | undefined;

afterEach(() => {
  cleanup();
  activeHarness?.restoreConsole();
  activeHarness = undefined;
});

test("権限失効は永続状態を変えず再実行可能である", async () => {
  const h = harness();
  activeHarness = h;
  h.setActiveTab(undefined);
  const contribution = h.createContribution();
  const { container } = await mount(contribution);
  const runAction = actionHandlerOf(contribution);

  await act(async () => {
    await runAction();
  });

  assert.match(container.textContent ?? "", /アクセス権限が失効/);
  assert.equal(h.createCandidateCalls.length, 0);

  h.setActiveTab({
    tabId: 7,
    url: "https://shop.example.invalid/products/x100",
  });
  await act(async () => {
    const user = userEvent.setup();
    await user.click(
      container.querySelector("[data-capture-retry]") as HTMLElement,
    );
  });

  assert.match(container.textContent ?? "", /架空CPU X100/);
});

test("制限ページは注入を試みず対象外であることを表示する", async () => {
  const h = harness();
  activeHarness = h;
  h.setActiveTab({ tabId: 9, url: "chrome://newtab/" });
  const contribution = h.createContribution();
  const { container } = await mount(contribution);
  const runAction = actionHandlerOf(contribution);

  await act(async () => {
    await runAction();
  });

  assert.match(container.textContent ?? "", /対象外です/);
  assert.equal(h.injectCalls, 0);
});

test("容量不足の保存失敗は抽出結果と選択projectを保持し識別可能な理由を表示する", async () => {
  const h = harness();
  activeHarness = h;
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
  h.setCreateResult(err({ kind: "quota" }));
  await user.click(
    container.querySelector("[data-capture-submit]") as HTMLElement,
  );

  assert.match(container.textContent ?? "", /保存容量が不足/);
  assert.match(container.textContent ?? "", /架空CPU X100/);
  assert.equal(
    (
      container.querySelector(
        "[data-capture-project-select]",
      ) as HTMLSelectElement
    ).value,
    PROJECT_ID,
  );
});

test("保存領域の利用不能による失敗は既存データを上書きせず理由を表示する", async () => {
  const h = harness();
  activeHarness = h;
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
  h.setCreateResult(err({ kind: "storage" }));
  await user.click(
    container.querySelector("[data-capture-submit]") as HTMLElement,
  );

  assert.match(container.textContent ?? "", /保存領域を利用できません/);
  assert.equal(h.createCandidateCalls.length, 1);
});

test("保存中の連打操作でも候補は一件しか作成されない", async () => {
  const h = harness();
  activeHarness = h;
  const hold = h.holdCreateCandidate();
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
  const submitButton = container.querySelector(
    "[data-capture-submit]",
  ) as HTMLElement;
  await act(async () => {
    await user.click(submitButton);
    await user.click(submitButton);
  });

  hold.release();
  await act(async () => {
    await Promise.resolve();
  });

  assert.equal(h.createCandidateCalls.length, 1);
});

test("抽出候補ゼロでも手入力から詳細編集を型付きprefillで開ける", async () => {
  const h = harness();
  activeHarness = h;
  h.setPage("<!doctype html><html><body></body></html>");
  const contribution = h.createContribution();
  const { container } = await mount(contribution);
  const runAction = actionHandlerOf(contribution);
  await act(async () => {
    await runAction();
  });

  assert.match(container.textContent ?? "", /自動取得できませんでした/);

  const user = userEvent.setup();
  await user.type(
    container.querySelector("[data-capture-manual-name]") as HTMLElement,
    "架空手入力品",
  );
  await user.click(
    container.querySelector("[data-capture-open-detail-edit]") as HTMLElement,
  );

  assert.equal(h.editorCalls.length, 1);
  assert.equal(h.editorCalls[0]?.projectId, PROJECT_ID);
  assert.equal(h.editorCalls[0]?.draft.product.name.confirmed, "架空手入力品");
});

test("実行可能なページ値は安全なtextとして描画されHTMLとして解釈されない", async () => {
  const h = harness();
  activeHarness = h;
  h.setPage(
    "<!doctype html><html><body><h1>&lt;img src=x onerror=alert(1)&gt;</h1></body></html>",
  );
  const contribution = h.createContribution();
  const { container } = await mount(contribution);
  const runAction = actionHandlerOf(contribution);
  await act(async () => {
    await runAction();
  });

  assert.equal(container.querySelector("img"), null);
  assert.equal(
    (container.querySelector("[data-capture-field='name']") as HTMLInputElement)
      .value,
    "<img src=x onerror=alert(1)>",
  );
});

test("商品値や取得元URLが診断ログへ記録されない", async () => {
  const h = harness();
  activeHarness = h;
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
    container.querySelector("[data-capture-submit]") as HTMLElement,
  );

  const leaked = h.consoleCalls.some((args) =>
    args.some(
      (value) =>
        typeof value === "string" &&
        (value.includes("架空CPU X100") ||
          value.includes("shop.example.invalid")),
    ),
  );
  assert.equal(leaked, false);
});
