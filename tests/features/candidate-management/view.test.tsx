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

const createState = (
  service: CandidateManagementService = {} as CandidateManagementService,
) =>
  createManagementState({
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
          error: { kind: "not-found" as const, entity: "candidate" as const },
        };
      },
    } satisfies CandidateQuery,
    service,
    createMutationContext: () => context,
  });

async function renderView(service?: CandidateManagementService) {
  const state = createState(service);
  await state.load();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(() => root.render(<ManagementView state={state} />));
  return {
    container,
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

  assert.match(rendered.container.textContent ?? "", /メイン構成/);
  assert.match(rendered.container.textContent ?? "", /CPU/);
  assert.match(rendered.container.textContent ?? "", /未分類/);
  assert.match(rendered.container.textContent ?? "", /未入力/);
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
    "[aria-label='候補一覧']",
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
  const project = rendered.container.querySelector(
    "[data-project-id='10000000-0000-4000-8000-000000000002']",
  ) as HTMLButtonElement;
  await act(async () => project.click());
  assert.match(candidateList?.textContent ?? "", /別プロジェクトの GPU/);
  assert.doesNotMatch(candidateList?.textContent ?? "", /未分類の候補/);

  await rendered.cleanup();
});

test("空名を拒否し、フォームからプロジェクトを作成・改名する", async () => {
  const createdProjectId =
    "10000000-0000-4000-8000-000000000003" as Uuid as ProjectId;
  const service = {
    async createProject({ name }: { readonly name: string }) {
      const project = {
        id: createdProjectId,
        name,
        createdAt: "2026-07-22T00:00:00.000Z" as never,
        updatedAt: "2026-07-22T00:00:00.000Z" as never,
      };
      projectSummaries.push({
        id: project.id,
        name: project.name,
        updatedAt: project.updatedAt,
      });
      return { ok: true as const, value: project };
    },
    async renameProject({
      id,
      name,
    }: {
      readonly id: ProjectId;
      readonly name: string;
    }) {
      const project = projectSummaries.find((item) => item.id === id);
      if (project === undefined) throw new Error("test project is missing");
      const renamed = { ...project, name };
      projectSummaries.splice(projectSummaries.indexOf(project), 1, renamed);
      return {
        ok: true as const,
        value: {
          ...renamed,
          createdAt: "2026-07-22T00:00:00.000Z" as never,
        },
      };
    },
  } as unknown as CandidateManagementService;
  const rendered = await renderView(service);
  const input = rendered.container.querySelector(
    "[name='project-name']",
  ) as HTMLInputElement;
  const form = rendered.container.querySelector(
    "[aria-label='プロジェクト編集']",
  ) as HTMLFormElement;

  await act(async () => form.requestSubmit());
  assert.match(
    rendered.container.textContent ?? "",
    /プロジェクト名を入力してください/,
  );
  assert.equal(input.value, "");

  await act(async () => {
    setInputValue(input, "新しい構成");
  });
  await act(async () => form.requestSubmit());
  assert.match(rendered.container.textContent ?? "", /新しい構成/);

  const rename = rendered.container.querySelector(
    `[data-rename-project-id='${firstProjectId}']`,
  ) as HTMLButtonElement;
  await act(async () => rename.click());
  assert.equal(input.value, "メイン構成");
  await act(async () => {
    setInputValue(input, "改名後の構成");
  });
  await act(async () => form.requestSubmit());
  assert.match(rendered.container.textContent ?? "", /改名後の構成/);

  await rendered.cleanup();
});

test("プロジェクト保存の失敗では入力を保持して再試行できる", async () => {
  const service = {
    async createProject() {
      return { ok: false as const, error: { kind: "storage" as const } };
    },
  } as unknown as CandidateManagementService;
  const rendered = await renderView(service);
  const input = rendered.container.querySelector(
    "[name='project-name']",
  ) as HTMLInputElement;
  const form = rendered.container.querySelector(
    "[aria-label='プロジェクト編集']",
  ) as HTMLFormElement;

  await act(async () => setInputValue(input, "保存を再試行する構成"));
  await act(async () => form.requestSubmit());

  assert.equal(input.value, "保存を再試行する構成");
  assert.match(
    rendered.container.textContent ?? "",
    /保存領域を利用できません/,
  );

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

  assert.match(container.textContent ?? "", /候補を作成/);
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
      "[aria-label='候補編集']",
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
      return { ok: false as const, error: { kind: "storage" as const } };
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
    "[aria-label='候補編集']",
  ) as HTMLFormElement;

  await act(async () => setInputValue(input, ""));
  await act(async () => form.requestSubmit());
  assert.equal(input.value, "");
  assert.match(container.textContent ?? "", /商品名を入力してください/);

  await act(async () => setInputValue(input, "保存を再試行する候補"));
  await act(async () => form.requestSubmit());

  assert.equal(input.value, "保存を再試行する候補");
  assert.match(container.textContent ?? "", /保存領域を利用できません/);

  await act(() => root.unmount());
  container.remove();
});

test("プロジェクト削除では対象と所属候補への影響を確認してから実行する", async () => {
  let deletedProjectId: ProjectId | undefined;
  const service = {
    async deleteProject(id: ProjectId) {
      deletedProjectId = id;
      return { ok: true as const, value: undefined };
    },
  } as unknown as CandidateManagementService;
  const rendered = await renderView(service);

  const request = rendered.container.querySelector(
    `[data-delete-project-id='${firstProjectId}']`,
  ) as HTMLButtonElement;
  const projectName = (
    rendered.container.querySelector(
      `[data-project-id='${firstProjectId}']`,
    ) as HTMLButtonElement
  ).textContent;
  await act(async () => request.click());

  const confirmation = rendered.container.querySelector(
    "[aria-label='削除確認']",
  );
  assert.match(confirmation?.textContent ?? "", new RegExp(projectName ?? ""));
  assert.match(confirmation?.textContent ?? "", /所属する候補も削除/);
  assert.equal(deletedProjectId, undefined);

  const confirm = rendered.container.querySelector(
    "[data-confirm-deletion]",
  ) as HTMLButtonElement;
  await act(async () => confirm.click());
  assert.equal(deletedProjectId, firstProjectId);

  await rendered.cleanup();
});

test("候補削除の取消は保存を行わず、失敗時は候補と確認を維持する", async () => {
  let deleteCalls = 0;
  const service = {
    async deleteCandidate() {
      deleteCalls += 1;
      return { ok: false as const, error: { kind: "storage" as const } };
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
    /保存領域を利用できません/,
  );
  assert.notEqual(
    rendered.container.querySelector("[aria-label='削除確認']"),
    null,
  );

  await rendered.cleanup();
});
