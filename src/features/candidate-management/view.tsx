import type { FormEvent } from "react";
import { useReducer, useState } from "react";

import { PART_CATEGORIES, type PartCategory } from "../../domain/public.js";
import type { CandidateSummary } from "./contracts.js";
import type { ManagementState } from "./state.js";

const categoryLabels: Readonly<Record<PartCategory, string>> = {
  cpu: "CPU",
  "cpu-cooler": "CPUクーラー",
  motherboard: "マザーボード",
  memory: "メモリ",
  gpu: "GPU",
  storage: "ストレージ",
  "power-supply": "電源",
  case: "ケース",
  "case-fan": "ケースファン",
  "expansion-card": "拡張カード",
  other: "その他",
  uncategorized: "未分類",
};

function displayValue(
  value:
    | { readonly original: string | null; readonly confirmed?: string }
    | undefined,
): string {
  return value?.confirmed ?? value?.original ?? "未入力";
}

function CandidateListItem({
  candidate,
}: {
  readonly candidate: CandidateSummary;
}) {
  return (
    <li className="candidate-management__candidate">
      <h3>{displayValue(candidate.name)}</h3>
      <dl>
        <div>
          <dt>カテゴリ</dt>
          <dd>{categoryLabels[candidate.category]}</dd>
        </div>
        <div>
          <dt>メーカー</dt>
          <dd>{displayValue(candidate.manufacturer)}</dd>
        </div>
        <div>
          <dt>型番</dt>
          <dd>{displayValue(candidate.modelNumber)}</dd>
        </div>
        <div>
          <dt>価格</dt>
          <dd>{candidate.price === undefined ? "未入力" : "入力済み"}</dd>
        </div>
      </dl>
      {candidate.hasMissingDetails ? <p>未入力の項目があります</p> : null}
    </li>
  );
}

/** Renders feature-owned state without moving domain state into React hooks. */
export function ManagementView({ state }: { readonly state: ManagementState }) {
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const [projectName, setProjectName] = useState("");
  const [editingProjectId, setEditingProjectId] = useState<
    (typeof state.value.projects)[number]["id"] | null
  >(null);
  const [projectNameError, setProjectNameError] = useState<string | null>(null);
  const value = state.value;

  const selectProject = async (
    projectId: (typeof value.projects)[number]["id"],
  ) => {
    await state.selectProject(projectId);
    rerender();
  };
  const selectCategory = async (category: PartCategory | null) => {
    await state.selectCategory(category);
    rerender();
  };
  const beginRenameProject = (project: (typeof value.projects)[number]) => {
    setEditingProjectId(project.id);
    setProjectName(project.name);
    setProjectNameError(null);
  };
  const saveProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (projectName.trim().length === 0) {
      setProjectNameError("プロジェクト名を入力してください");
      return;
    }
    setProjectNameError(null);
    if (editingProjectId === null) {
      await state.createProject(projectName);
    } else {
      await state.renameProject(editingProjectId, projectName);
    }
    if (state.value.displayError === null) {
      setProjectName("");
      setEditingProjectId(null);
    }
    rerender();
  };

  return (
    <section aria-label="候補管理" className="candidate-management">
      <nav aria-label="プロジェクト">
        {value.projects.map((project) => (
          <span key={project.id}>
            <button
              aria-current={
                project.id === value.selectedProjectId ? "page" : undefined
              }
              data-project-id={project.id}
              onClick={() => void selectProject(project.id)}
              type="button"
            >
              {project.name}
            </button>
            <button
              data-rename-project-id={project.id}
              disabled={value.isSaving || value.mutationsDisabled}
              onClick={() => beginRenameProject(project)}
              type="button"
            >
              名前を変更
            </button>
          </span>
        ))}
      </nav>
      <form
        aria-label="プロジェクト編集"
        onSubmit={(event) => void saveProject(event)}
      >
        <label>
          {editingProjectId === null
            ? "新しいプロジェクト名"
            : "プロジェクト名"}
          <input
            aria-describedby={
              projectNameError === null ? undefined : "project-name-error"
            }
            aria-invalid={projectNameError === null ? undefined : true}
            disabled={value.isSaving || value.mutationsDisabled}
            name="project-name"
            onChange={(event) => {
              setProjectName(event.target.value);
              setProjectNameError(null);
            }}
            value={projectName}
          />
        </label>
        {projectNameError === null ? null : (
          <p id="project-name-error" role="alert">
            {projectNameError}
          </p>
        )}
        {value.displayError === null ? null : (
          <p role="alert">保存に失敗しました。もう一度お試しください。</p>
        )}
        <button
          disabled={value.isSaving || value.mutationsDisabled}
          type="submit"
        >
          {editingProjectId === null
            ? "プロジェクトを作成"
            : "プロジェクト名を保存"}
        </button>
        {editingProjectId === null ? null : (
          <button
            disabled={value.isSaving}
            onClick={() => {
              setEditingProjectId(null);
              setProjectName("");
              setProjectNameError(null);
            }}
            type="button"
          >
            キャンセル
          </button>
        )}
      </form>
      <nav aria-label="カテゴリ">
        <button
          aria-current={value.selectedCategory === null ? "page" : undefined}
          data-category="all"
          onClick={() => void selectCategory(null)}
          type="button"
        >
          すべて
        </button>
        {PART_CATEGORIES.map((category) => (
          <button
            aria-current={
              category === value.selectedCategory ? "page" : undefined
            }
            data-category={category}
            key={category}
            onClick={() => void selectCategory(category)}
            type="button"
          >
            {categoryLabels[category]}
          </button>
        ))}
      </nav>
      <ul aria-label="候補一覧">
        {value.candidates.map((candidate) => (
          <CandidateListItem candidate={candidate} key={candidate.id} />
        ))}
      </ul>
    </section>
  );
}
