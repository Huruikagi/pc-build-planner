import assert from "node:assert/strict";
import test from "node:test";

import { userEvent } from "@testing-library/user-event";
import { act } from "react";
import { createRoot } from "react-dom/client";

import type { OperationPolicy } from "../../../src/application-shell/public.js";
import type {
  CandidatePart,
  CandidatePartId,
  ProjectId,
  RequestId,
  Revision,
  Uuid,
} from "../../../src/domain/public.js";
import type {
  CandidateDraft,
  CandidateManagementQuery,
  CandidateManagementService,
  CandidateOperationError,
  CandidateSummary,
  MutationContext,
  UpdateCandidateInput,
} from "../../../src/features/candidate-management/contracts.js";
import type { DuplicateMergeCoordinator } from "../../../src/features/candidate-management/duplicate-merge.js";
import { createManagementState } from "../../../src/features/candidate-management/state.js";
import { ManagementView } from "../../../src/features/candidate-management/view.js";
import { defaultMessageResolver } from "../../../src/ui-messages/public.js";

const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const candidateId =
  "30000000-0000-4000-8000-000000000001" as Uuid as CandidatePartId;
const timestamp = "2026-07-22T00:00:00.000Z" as never;
const context: MutationContext = {
  requestId: "20000000-0000-4000-8000-000000000001" as Uuid as RequestId,
  expectedRevision: 0 as Revision,
};

/** A stored candidate whose attributes and source data a summary cannot carry. */
const storedDraft: CandidateDraft = {
  projectId,
  category: "cpu",
  product: {
    name: { original: "架空CPU", confirmed: "架空CPU 確認済み" },
    manufacturer: { original: "架空メーカー" },
  },
  normalizedAttributes: {
    category: "cpu",
    socket: { original: "架空ソケットSK1" },
  },
  sources: [
    {
      id: "40000000-0000-4000-8000-000000000001" as never,
      pageUrl: "https://example.invalid/synthetic-cpu",
    },
  ],
  primarySourceId: "40000000-0000-4000-8000-000000000001" as never,
  sourceSnapshot: { price: "架空の元表記" },
};

const summary: CandidateSummary = {
  id: candidateId,
  projectId,
  category: "cpu",
  name: { original: "架空CPU", confirmed: "架空CPU 確認済み" },
  manufacturer: { original: "架空メーカー" },
  hasMissingDetails: true,
  updatedAt: timestamp,
};

interface Harness {
  readonly container: HTMLElement;
  readonly created: CandidateDraft[];
  readonly updated: UpdateCandidateInput[];
  readonly draftReads: CandidatePartId[];
  cleanup(): Promise<void>;
}

const query = (draftReads: CandidatePartId[]): CandidateManagementQuery => ({
  async listProjects() {
    return {
      ok: true as const,
      value: [
        { id: projectId, name: "架空プロジェクト", updatedAt: timestamp },
      ],
    };
  },
  async listCandidates() {
    return { ok: true as const, value: [summary] };
  },
  async listBuildEligible() {
    return { ok: true as const, value: [] };
  },
  async getCandidateDraft(id) {
    draftReads.push(id);
    return { ok: true as const, value: storedDraft };
  },
});

const renderView = async (options?: {
  readonly saveFailure?: CandidateOperationError;
  readonly operationPolicy?: OperationPolicy;
  readonly duplicateMergeCoordinator?: DuplicateMergeCoordinator;
}): Promise<Harness> => {
  const created: CandidateDraft[] = [];
  const updated: UpdateCandidateInput[] = [];
  const draftReads: CandidatePartId[] = [];
  const failure = options?.saveFailure;
  const service = {
    async createCandidate(input: CandidateDraft) {
      created.push(input);
      return failure === undefined
        ? { ok: true as const, value: {} as CandidatePart }
        : { ok: false as const, error: failure };
    },
    async updateCandidate(input: UpdateCandidateInput) {
      updated.push(input);
      return failure === undefined
        ? { ok: true as const, value: {} as CandidatePart }
        : { ok: false as const, error: failure };
    },
  } as unknown as CandidateManagementService;

  const state = createManagementState({
    query: query(draftReads),
    service,
    createMutationContext: () => context,
    currentProject: {
      getCurrentProject: () => ({ status: "resolved", projectId }),
      subscribe: () => () => {},
      async refresh() {
        return {
          ok: true,
          value: { status: "resolved", projectId },
        };
      },
    },
    ...(options?.duplicateMergeCoordinator === undefined
      ? {}
      : { duplicateMergeCoordinator: options.duplicateMergeCoordinator }),
  });
  // Mirrors registration: the shell supplies its gate at mount time.
  if (options?.operationPolicy !== undefined)
    state.attachOperationPolicy(options.operationPolicy);
  await state.load();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(() => root.render(<ManagementView state={state} />));
  return {
    container,
    created,
    updated,
    draftReads,
    cleanup: async () => {
      state.releaseOperationPolicy();
      await act(() => root.unmount());
      container.remove();
    },
  };
};

const click = async (element: Element | null): Promise<void> => {
  assert.ok(element, "操作対象のUI導線が見つかりません");
  await act(async () => (element as HTMLElement).click());
};

const setInputValue = async (
  input: HTMLInputElement,
  value: string,
): Promise<void> => {
  const user = userEvent.setup();
  await act(async () => {
    await user.clear(input);
    await user.type(input, value);
  });
};

const input = (harness: Harness, name: string): HTMLInputElement => {
  const found = harness.container.querySelector(`input[name='${name}']`);
  assert.ok(found, `${name} 入力欄が見つかりません`);
  return found as HTMLInputElement;
};

const submitEditor = async (harness: Harness): Promise<void> => {
  const form = harness.container.querySelector(
    "form[data-region='candidate-form']",
  );
  assert.ok(form, "候補編集フォームが見つかりません");
  await act(async () => (form as HTMLFormElement).requestSubmit());
};

test("候補一覧の作成導線から選択中プロジェクトの候補を登録できる", async () => {
  const harness = await renderView();

  await click(harness.container.querySelector("[data-create-candidate]"));
  assert.match(
    harness.container.textContent ?? "",
    new RegExp(defaultMessageResolver("candidate.createCandidateHeading")),
  );

  await setInputValue(
    input(harness, "candidate-name"),
    "画面から作成した架空候補",
  );
  await submitEditor(harness);

  assert.equal(harness.created.length, 1);
  assert.equal(harness.created[0]?.projectId, projectId);
  assert.equal(
    harness.created[0]?.product.name.confirmed,
    "画面から作成した架空候補",
  );
  // Requirement 2.4: an unspecified category stays uncategorized.
  assert.equal(harness.created[0]?.category, "uncategorized");

  await harness.cleanup();
});

test("production editorのmatchなし保存は入力とaccessibility契約を保ち判断DOMを挟まない", async () => {
  const evaluated: CandidateDraft[] = [];
  const harness = await renderView({
    duplicateMergeCoordinator: {
      async evaluate(draft) {
        evaluated.push(draft);
        return {
          ok: true,
          value: { kind: "saved-new", candidate: {} as CandidatePart },
        };
      },
      async complete() {
        throw new Error("matchなしではcompleteしてはならない");
      },
    },
  });

  await click(harness.container.querySelector("[data-create-candidate]"));
  const name = input(harness, "candidate-name");
  await setInputValue(name, "編集中の架空候補");
  assert.equal(name.value, "編集中の架空候補");
  assert.equal(name.required, false);
  assert.equal(name.getAttribute("aria-describedby"), null);
  assert.equal(
    harness.container.querySelector('[data-region="duplicate-merge-decision"]'),
    null,
  );

  await submitEditor(harness);
  assert.equal(evaluated.length, 1);
  assert.equal(evaluated[0]?.product.name.confirmed, "編集中の架空候補");
  assert.equal(
    harness.container.querySelector('[data-region="duplicate-merge-decision"]'),
    null,
  );
  await harness.cleanup();
});

test("候補の編集導線は詳細取得契約から属性と元表記を含むdraftを復元する", async () => {
  const harness = await renderView();

  await click(
    harness.container.querySelector(
      `[data-edit-candidate-id='${candidateId}']`,
    ),
  );

  // Requirement 4.1: the editor is opened from the stored draft, not the summary.
  assert.deepEqual(harness.draftReads, [candidateId]);
  assert.match(
    harness.container.textContent ?? "",
    new RegExp(defaultMessageResolver("candidate.editCandidateHeading")),
  );
  assert.equal(input(harness, "candidate-name").value, "架空CPU 確認済み");
  assert.equal(input(harness, "attribute-socket").value, "架空ソケットSK1");
  assert.equal(
    input(harness, "source-0-url").value,
    "https://example.invalid/synthetic-cpu",
  );
  const snapshot = harness.container.querySelector(
    "textarea[name='candidate-source-snapshot']",
  ) as HTMLTextAreaElement | null;
  assert.ok(snapshot);
  assert.equal(snapshot.readOnly, true);
  assert.match(snapshot.value, /架空の元表記/);

  await harness.cleanup();
});

test("編集導線から確定した変更は更新コマンドとして保存される", async () => {
  const harness = await renderView();

  await click(
    harness.container.querySelector(
      `[data-edit-candidate-id='${candidateId}']`,
    ),
  );
  await setInputValue(input(harness, "candidate-name"), "編集後の架空CPU");
  await submitEditor(harness);

  // Requirement 4.2: the confirmed value reaches the update command.
  assert.equal(harness.updated.length, 1);
  assert.equal(harness.updated[0]?.id, candidateId);
  assert.equal(
    harness.updated[0]?.draft.product.name.confirmed,
    "編集後の架空CPU",
  );

  await harness.cleanup();
});

test("カテゴリ変更後は新カテゴリの属性を編集でき共通項目と元表記を保持する", async () => {
  const harness = await renderView();

  await click(
    harness.container.querySelector(
      `[data-edit-candidate-id='${candidateId}']`,
    ),
  );
  const select = harness.container.querySelector(
    "select[name='candidate-category']",
  ) as HTMLSelectElement | null;
  assert.ok(select);
  await act(async () => {
    select.value = "memory";
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
  });

  // Requirement 4.4: the newly selected category exposes its own attributes.
  assert.equal(input(harness, "attribute-memoryStandard").value, "");
  assert.equal(
    harness.container.querySelector("input[name='attribute-socket']"),
    null,
  );
  // Requirement 4.3: shared fields and source metadata survive the change.
  assert.equal(input(harness, "candidate-name").value, "架空CPU 確認済み");
  assert.equal(
    input(harness, "source-0-url").value,
    "https://example.invalid/synthetic-cpu",
  );

  await setInputValue(
    input(harness, "attribute-memoryStandard"),
    "架空DDR規格",
  );
  await submitEditor(harness);

  assert.equal(harness.updated[0]?.draft.category, "memory");
  assert.deepEqual(harness.updated[0]?.draft.normalizedAttributes, {
    category: "memory",
    memoryStandard: { original: null, confirmed: "架空DDR規格" },
  });

  await harness.cleanup();
});

test("項目検証の失敗は該当欄へ対応付けられ入力内容と一覧を保持する", async () => {
  const harness = await renderView({
    saveFailure: {
      kind: "candidate-validation",
      fields: { "sources[0].pageUrl": "invalid-url" },
    },
  });

  await click(
    harness.container.querySelector(
      `[data-edit-candidate-id='${candidateId}']`,
    ),
  );
  await setInputValue(input(harness, "source-0-url"), "ftp://例");
  await submitEditor(harness);

  // Requirement 4.5: the offending field is identified, not just the operation.
  const url = input(harness, "source-0-url");
  assert.equal(url.getAttribute("aria-invalid"), "true");
  const describedBy = url.getAttribute("aria-describedby");
  assert.ok(describedBy);
  const message = harness.container.querySelector(`#${describedBy}`);
  assert.ok(message);
  assert.match(message.textContent ?? "", /URL/);
  // The draft and the existing list are preserved.
  assert.equal(url.value, "ftp://例");
  assert.equal(input(harness, "candidate-name").value, "架空CPU 確認済み");
  assert.match(harness.container.textContent ?? "", /架空CPU 確認済み/);

  await harness.cleanup();
});

test("破損・非対応、容量不足、利用不能を利用者が区別できる表示へ分ける", async () => {
  const messages = new Map<string, string>();
  for (const failure of [
    { code: "unsupported-version" },
    { code: "quota-exceeded" },
    { code: "storage-unavailable" },
    { code: "maintenance-active" },
    { code: "revision-conflict" },
  ] as const) {
    const state = createManagementState({
      query: {
        ...query([]),
        async listProjects() {
          return { ok: false as const, error: failure };
        },
      },
      service: {} as CandidateManagementService,
      createMutationContext: () => context,
    });
    await state.load();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(() => root.render(<ManagementView state={state} />));
    const alert = container.querySelector("[role='alert']");
    assert.ok(alert, `${failure.code} の案内が表示されません`);
    messages.set(failure.code, alert.textContent ?? "");
    // Terminal read failures must also stop mutation entry points.
    if (
      failure.code !== "maintenance-active" &&
      failure.code !== "revision-conflict"
    ) {
      const create = container.querySelector(
        "[data-create-candidate]",
      ) as HTMLButtonElement | null;
      assert.ok(create);
      assert.equal(create.disabled, true);
    }
    await act(() => root.unmount());
    container.remove();
  }

  assert.equal(new Set(messages.values()).size, messages.size);
  assert.match(
    messages.get("unsupported-version") ?? "",
    new RegExp(defaultMessageResolver("candidate.errors.unsupportedData")),
  );
  assert.match(
    messages.get("quota-exceeded") ?? "",
    new RegExp(defaultMessageResolver("persistenceError.quota")),
  );
  assert.match(
    messages.get("storage-unavailable") ?? "",
    new RegExp(defaultMessageResolver("candidate.errors.storage")),
  );
});

test("mount後にmaintenanceが開始すると操作要素が即座に無効表示へ切り替わる", async () => {
  let mutationAllowed = true;
  const listeners = new Set<() => void>();
  const harness = await renderView({
    operationPolicy: {
      isAllowed: (kind) => kind === "read" || mutationAllowed,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  });
  const create = () =>
    harness.container.querySelector(
      "[data-create-candidate]",
    ) as HTMLButtonElement;
  const edit = () =>
    harness.container.querySelector(
      `[data-edit-candidate-id='${candidateId}']`,
    ) as HTMLButtonElement;

  assert.equal(create().disabled, false);

  // The shell flips its gate without remounting the feature.
  mutationAllowed = false;
  await act(async () => {
    for (const listener of listeners) listener();
  });

  assert.equal(create().disabled, true);
  assert.equal(edit().disabled, true);
  await click(edit());
  assert.deepEqual(harness.draftReads, []);

  // Leaving maintenance restores the entry points.
  mutationAllowed = true;
  await act(async () => {
    for (const listener of listeners) listener();
  });
  assert.equal(create().disabled, false);

  await harness.cleanup();
  // Unmount detaches from the shell gate exactly once.
  assert.equal(listeners.size, 0);
});

test("maintenance中は変更操作を開始できずserviceを呼ばない", async () => {
  const harness = await renderView({
    operationPolicy: {
      isAllowed: (kind) => kind === "read",
      subscribe: () => () => {},
    },
  });

  const create = harness.container.querySelector(
    "[data-create-candidate]",
  ) as HTMLButtonElement | null;
  assert.ok(create);
  assert.equal(create.disabled, true);

  await click(
    harness.container.querySelector(
      `[data-edit-candidate-id='${candidateId}']`,
    ),
  );
  await click(create);

  // The editor never opens, so no draft can be submitted to the service.
  assert.equal(
    harness.container.querySelector("form[data-region='candidate-form']"),
    null,
  );
  assert.deepEqual(harness.draftReads, []);
  assert.deepEqual(harness.created, []);
  assert.deepEqual(harness.updated, []);
  // Requirement 5.3 of the shell: reading and navigation stay available.
  assert.match(harness.container.textContent ?? "", /架空CPU 確認済み/);

  await harness.cleanup();
});

test("欠損した任意項目は空欄で開き、一覧の未入力表示を値として持ち込まない", async () => {
  const harness = await renderView();

  await click(harness.container.querySelector("[data-create-candidate]"));

  // Requirement 3.4 / 4.1: the placeholder must not become an editable value.
  assert.equal(input(harness, "candidate-manufacturer").value, "");
  assert.equal(input(harness, "candidate-model-number").value, "");
  assert.equal(
    input(harness, "candidate-manufacturer").getAttribute("placeholder"),
    defaultMessageResolver("common.notEntered"),
  );

  await setInputValue(input(harness, "candidate-name"), "架空候補");
  await setInputValue(input(harness, "candidate-manufacturer"), "架空メーカー");
  await submitEditor(harness);

  assert.equal(
    harness.created[0]?.product.manufacturer?.confirmed,
    "架空メーカー",
  );

  await harness.cleanup();
});
