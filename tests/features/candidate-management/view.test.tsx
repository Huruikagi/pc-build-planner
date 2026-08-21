import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";
import { createRoot } from "react-dom/client";

import type {
  CandidatePartId,
  ProjectId,
  RequestId,
  Revision,
  Uuid,
} from "../../../src/domain/public.js";
import type {
  CandidateDraft,
  CandidateManagementService,
  CandidateQuery,
  MutationContext,
  ProjectSummary,
} from "../../../src/features/candidate-management/contracts.js";
import { createManagementState } from "../../../src/features/candidate-management/state.js";
import { ManagementView } from "../../../src/features/candidate-management/view.js";
import { defaultMessageResolver } from "../../../src/ui-messages/public.js";

const firstProjectId =
  "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const secondProjectId =
  "10000000-0000-4000-8000-000000000002" as Uuid as ProjectId;
const requestId = "20000000-0000-4000-8000-000000000001" as Uuid as RequestId;
const context: MutationContext = {
  requestId,
  expectedRevision: 0 as Revision,
};

const projectSummaries: ProjectSummary[] = [
  {
    id: firstProjectId,
    name: "メイン構成",
    updatedAt: "2026-07-22T00:00:00.000Z" as never,
  },
  {
    id: secondProjectId,
    name: "別プロジェクト",
    updatedAt: "2026-07-22T00:00:00.000Z" as never,
  },
];

const projectSwitches = new WeakMap<
  ReturnType<typeof createManagementState>,
  (projectId: ProjectId) => void
>();

const createState = (
  service: CandidateManagementService = {} as CandidateManagementService,
) => {
  let currentProjectId: ProjectId | null = firstProjectId;
  const listeners = new Set<() => void>();
  const state = createManagementState({
    query: {
      async listProjects() {
        return {
          ok: true as const,
          value: projectSummaries,
        };
      },
      async listCandidates({ projectId }) {
        const candidates = [
          {
            id: "30000000-0000-4000-8000-000000000001" as Uuid as CandidatePartId,
            projectId: firstProjectId,
            category: "cpu" as const,
            name: { original: "<img src=x onerror=alert(1)> CPU" },
            manufacturer: { original: "架空メーカー" },
            hasMissingDetails: false,
            updatedAt: "2026-07-22T00:00:00.000Z" as never,
          },
          {
            id: "30000000-0000-4000-8000-000000000002" as Uuid as CandidatePartId,
            projectId: firstProjectId,
            category: "uncategorized" as const,
            name: { original: "未分類の候補" },
            hasMissingDetails: true,
            updatedAt: "2026-07-22T00:00:00.000Z" as never,
          },
          {
            id: "30000000-0000-4000-8000-000000000003" as Uuid as CandidatePartId,
            projectId: secondProjectId,
            category: "gpu" as const,
            name: { original: "別プロジェクトの GPU" },
            hasMissingDetails: false,
            updatedAt: "2026-07-22T00:00:00.000Z" as never,
          },
        ];
        return {
          ok: true as const,
          value: candidates.filter(
            (candidate) => candidate.projectId === projectId,
          ),
        };
      },
      async listBuildEligible() {
        return { ok: true as const, value: [] };
      },
      async getCandidateDraft() {
        return {
          ok: false as const,
          error: {
            code: "validation" as const,
            reason: "entity-not-found" as const,
            message: "candidate",
          },
        };
      },
    } satisfies CandidateQuery,
    service,
    createMutationContext: () => context,
    currentProject: {
      getCurrentProject: () =>
        currentProjectId === null
          ? { status: "unresolved" }
          : { status: "resolved", projectId: currentProjectId },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async refresh() {
        currentProjectId = projectSummaries.some(
          (project) => project.id === currentProjectId,
        )
          ? currentProjectId
          : (projectSummaries[0]?.id ?? null);
        return {
          ok: true,
          value:
            currentProjectId === null
              ? { status: "unresolved" }
              : { status: "resolved", projectId: currentProjectId },
        };
      },
    },
  });
  state.attachCurrentProject();
  projectSwitches.set(state, (projectId) => {
    currentProjectId = projectId;
    for (const listener of listeners) listener();
  });
  return state;
};

async function renderView(service?: CandidateManagementService) {
  const state = createState(service);
  await state.load();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(() => root.render(<ManagementView state={state} />));
  return {
    container,
    state,
    switchProject: async (projectId: ProjectId) => {
      await act(async () => projectSwitches.get(state)?.(projectId));
    },
    cleanup: async () => {
      await act(() => root.unmount());
      container.remove();
    },
  };
}

const setInputValue = (input: HTMLInputElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  if (setter === undefined) throw new Error("input value setter is missing");
  setter.call(input, value);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
};

test("プロジェクト、全カテゴリ、未分類を含む候補一覧と欠損を描画する", async () => {
  const rendered = await renderView();

  assert.match(rendered.container.textContent ?? "", /CPU/);
  assert.match(
    rendered.container.textContent ?? "",
    new RegExp(defaultMessageResolver("category.uncategorized")),
  );
  assert.match(
    rendered.container.textContent ?? "",
    new RegExp(defaultMessageResolver("common.notEntered")),
  );
  assert.match(
    rendered.container.textContent ?? "",
    /<img src=x onerror=alert\(1\)> CPU/,
  );
  assert.equal(rendered.container.querySelector("img"), null);

  await rendered.cleanup();
});

test("プロジェクトまたはカテゴリを切り替えると該当候補だけを残す", async () => {
  const rendered = await renderView();
  const category = rendered.container.querySelector(
    "[data-category='uncategorized']",
  ) as HTMLButtonElement;
  await act(async () => category.click());
  const candidateList = rendered.container.querySelector(
    "[data-region='candidate-list']",
  );
  assert.match(candidateList?.textContent ?? "", /未分類の候補/);
  assert.doesNotMatch(
    candidateList?.textContent ?? "",
    /<img src=x onerror=alert\(1\)> CPU/,
  );

  const allCategories = rendered.container.querySelector(
    "[data-category='all']",
  ) as HTMLButtonElement;
  await act(async () => allCategories.click());
  await rendered.switchProject(secondProjectId);
  assert.match(candidateList?.textContent ?? "", /別プロジェクトの GPU/);
  assert.doesNotMatch(candidateList?.textContent ?? "", /未分類の候補/);

  await rendered.cleanup();
});

test("候補フォームは共通項目・カテゴリ属性・読み取り専用の元表記を分離し、カテゴリ変更後の属性を編集できる", async () => {
  const created: CandidateDraft[] = [];
  const service = {
    async createCandidate(draft: CandidateDraft) {
      created.push(draft);
      return {
        ok: true as const,
        value: {} as never,
      };
    },
  } as unknown as CandidateManagementService;
  const state = createState(service);
  await state.load();
  state.beginCreate({
    projectId: firstProjectId,
    category: "cpu",
    product: {
      name: { original: "架空 CPU" },
      manufacturer: { original: "架空メーカー" },
    },
    sourceSnapshot: { name: "取得時の CPU 名", socket: "AM5" },
    normalizedAttributes: { category: "cpu", socket: { original: "AM5" } },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(() => root.render(<ManagementView state={state} />));

  assert.match(
    container.textContent ?? "",
    new RegExp(defaultMessageResolver("candidate.createCandidateHeading")),
  );
  assert.equal(
    (
      container.querySelector(
        "[name='candidate-source-snapshot']",
      ) as HTMLTextAreaElement
    ).readOnly,
    true,
  );
  await act(async () => {
    (
      container.querySelector(
        "[name='candidate-category']",
      ) as HTMLSelectElement
    ).value = "gpu";
    (
      container.querySelector(
        "[name='candidate-category']",
      ) as HTMLSelectElement
    ).dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  assert.equal(container.querySelector("[name='attribute-socket']"), null);

  await act(async () => {
    const form = container.querySelector(
      "[data-region='candidate-form']",
    ) as HTMLFormElement;
    form.requestSubmit();
  });
  assert.equal(created.length, 1);
  assert.equal(created[0]?.category, "gpu");
  assert.deepEqual(created[0]?.sourceSnapshot, {
    name: "取得時の CPU 名",
    socket: "AM5",
  });

  await act(() => root.unmount());
  container.remove();
});

test("候補の無効入力と保存失敗では編集draftを画面に保持する", async () => {
  const service = {
    async createCandidate() {
      return {
        ok: false as const,
        error: { code: "storage-unavailable" as const },
      };
    },
  } as unknown as CandidateManagementService;
  const state = createState(service);
  await state.load();
  state.beginCreate({
    projectId: firstProjectId,
    category: "uncategorized",
    product: { name: { original: "保存前の候補" } },
    normalizedAttributes: { category: "uncategorized" },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(() => root.render(<ManagementView state={state} />));
  const input = container.querySelector(
    "[name='candidate-name']",
  ) as HTMLInputElement;
  const form = container.querySelector(
    "[data-region='candidate-form']",
  ) as HTMLFormElement;

  await act(async () => setInputValue(input, ""));
  await act(async () => form.requestSubmit());
  assert.equal(input.value, "");
  assert.match(
    container.textContent ?? "",
    new RegExp(defaultMessageResolver("candidate.nameRequiredError")),
  );

  await act(async () => setInputValue(input, "保存を再試行する候補"));
  await act(async () => form.requestSubmit());

  assert.equal(input.value, "保存を再試行する候補");
  assert.match(
    container.textContent ?? "",
    new RegExp(defaultMessageResolver("candidate.errors.storage")),
  );

  await act(() => root.unmount());
  container.remove();
});

test("候補削除の取消は保存を行わず、失敗時は候補と確認を維持する", async () => {
  let deleteCalls = 0;
  const service = {
    async deleteCandidate() {
      deleteCalls += 1;
      return {
        ok: false as const,
        error: { code: "storage-unavailable" as const },
      };
    },
  } as unknown as CandidateManagementService;
  const rendered = await renderView(service);
  const candidateId = "30000000-0000-4000-8000-000000000002";
  const request = rendered.container.querySelector(
    `[data-delete-candidate-id='${candidateId}']`,
  ) as HTMLButtonElement;

  await act(async () => request.click());
  const cancel = rendered.container.querySelector(
    "[data-cancel-deletion]",
  ) as HTMLButtonElement;
  await act(async () => cancel.click());
  assert.equal(deleteCalls, 0);
  assert.match(rendered.container.textContent ?? "", /未分類の候補/);

  await act(async () => request.click());
  const confirm = rendered.container.querySelector(
    "[data-confirm-deletion]",
  ) as HTMLButtonElement;
  await act(async () => confirm.click());

  assert.equal(deleteCalls, 1);
  assert.match(rendered.container.textContent ?? "", /未分類の候補/);
  assert.match(
    rendered.container.textContent ?? "",
    new RegExp(defaultMessageResolver("candidate.errors.storage")),
  );
  assert.notEqual(rendered.container.querySelector('[role="dialog"]'), null);

  await rendered.cleanup();
});
