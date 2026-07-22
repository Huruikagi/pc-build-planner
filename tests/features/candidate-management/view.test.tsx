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
  CandidateManagementService,
  CandidateQuery,
  MutationContext,
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

const createState = () =>
  createManagementState({
    query: {
      async listProjects() {
        return {
          ok: true as const,
          value: [
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
          ],
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
    } satisfies CandidateQuery,
    service: {} as CandidateManagementService,
    createMutationContext: () => context,
  });

async function renderView() {
  const state = createState();
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
