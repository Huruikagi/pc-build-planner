import type { FormEvent } from "react";
import { useReducer, useState } from "react";

import {
  PART_CATEGORIES,
  type PartCategory,
  type UtcTimestamp,
} from "../../domain/public.js";
import type { CandidateDraft, CandidateSummary } from "./contracts.js";
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
  onDelete,
}: {
  readonly candidate: CandidateSummary;
  readonly onDelete: (candidate: CandidateSummary) => void;
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
      <button
        data-delete-candidate-id={candidate.id}
        onClick={() => onDelete(candidate)}
        type="button"
      >
        削除
      </button>
    </li>
  );
}

const attributesFor = (
  category: PartCategory,
): CandidateDraft["normalizedAttributes"] => {
  switch (category) {
    case "cpu":
      return { category, socket: { original: null } };
    case "cpu-cooler":
      return { category, supportedSockets: { original: null } };
    case "motherboard":
      return {
        category,
        socket: { original: null },
        memoryStandard: { original: null },
        formFactor: { original: null },
      };
    case "memory":
      return { category, memoryStandard: { original: null } };
    case "power-supply":
      return { category, formFactor: { original: null } };
    case "case":
      return {
        category,
        supportedMotherboardFormFactors: { original: null },
        supportedPowerSupplyFormFactors: { original: null },
      };
    default:
      return { category };
  }
};

const changeCategory = (
  draft: CandidateDraft,
  category: PartCategory,
): CandidateDraft =>
  ({
    ...draft,
    category,
    normalizedAttributes: attributesFor(category),
  }) as CandidateDraft;

type EditableAttribute = {
  readonly key: string;
  readonly label: string;
  readonly list: boolean;
};

const editableAttributes = (
  category: PartCategory,
): readonly EditableAttribute[] => {
  switch (category) {
    case "cpu":
      return [{ key: "socket", label: "ソケット", list: false }];
    case "cpu-cooler":
      return [{ key: "supportedSockets", label: "対応ソケット", list: true }];
    case "motherboard":
      return [
        { key: "socket", label: "ソケット", list: false },
        { key: "memoryStandard", label: "メモリ規格", list: false },
        { key: "formFactor", label: "フォームファクター", list: false },
      ];
    case "memory":
      return [{ key: "memoryStandard", label: "メモリ規格", list: false }];
    case "power-supply":
      return [{ key: "formFactor", label: "フォームファクター", list: false }];
    case "case":
      return [
        {
          key: "supportedMotherboardFormFactors",
          label: "対応マザーボード規格",
          list: true,
        },
        {
          key: "supportedPowerSupplyFormFactors",
          label: "対応電源規格",
          list: true,
        },
      ];
    default:
      return [];
  }
};

function CandidateEditorForm({ state }: { readonly state: ManagementState }) {
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const [nameError, setNameError] = useState<string | null>(null);
  const editor = state.value.editor;
  if (editor === null) return null;
  const { draft } = editor;
  const update = (next: CandidateDraft) => {
    state.updateEditorDraft(next);
    rerender();
  };
  const setProductText = (
    field: "name" | "manufacturer" | "modelNumber" | "notes",
    value: string,
  ) => {
    const previous = draft.product[field];
    update({
      ...draft,
      product: {
        ...draft.product,
        [field]: { original: previous?.original ?? null, confirmed: value },
      },
    } as CandidateDraft);
    if (field === "name") setNameError(null);
  };
  const attributes = draft.normalizedAttributes;
  const setAttribute = (field: EditableAttribute, value: string) =>
    update({
      ...draft,
      normalizedAttributes: {
        ...attributes,
        [field.key]: {
          original: null,
          confirmed: field.list
            ? value
                .split(",")
                .map((item) => item.trim())
                .filter((item) => item.length > 0)
            : value,
        },
      },
    } as CandidateDraft);
  const attributeValues = attributes as unknown as Readonly<
    Record<
      string,
      {
        readonly original: string | null;
        readonly confirmed?: string | readonly string[];
      }
    >
  >;

  return (
    <form
      aria-label="候補編集"
      onSubmit={async (event) => {
        event.preventDefault();
        const name =
          draft.product.name.confirmed ?? draft.product.name.original ?? "";
        if (name.trim().length === 0) {
          setNameError("商品名を入力してください");
          return;
        }
        await state.saveEditor();
        rerender();
      }}
    >
      <h2>{editor.mode === "create" ? "候補を作成" : "候補を編集"}</h2>
      <label>
        商品名
        <input
          disabled={state.value.isSaving || state.value.mutationsDisabled}
          aria-describedby={
            nameError === null ? undefined : "candidate-name-error"
          }
          aria-invalid={nameError === null ? undefined : true}
          name="candidate-name"
          onChange={(event) => setProductText("name", event.target.value)}
          value={displayValue(draft.product.name)}
        />
      </label>
      {nameError === null ? null : (
        <p id="candidate-name-error" role="alert">
          {nameError}
        </p>
      )}
      <label>
        メーカー
        <input
          name="candidate-manufacturer"
          onChange={(event) =>
            setProductText("manufacturer", event.target.value)
          }
          value={displayValue(draft.product.manufacturer)}
        />
      </label>
      <label>
        型番
        <input
          name="candidate-model-number"
          onChange={(event) =>
            setProductText("modelNumber", event.target.value)
          }
          value={displayValue(draft.product.modelNumber)}
        />
      </label>
      <label>
        価格
        <input
          inputMode="decimal"
          name="candidate-price-amount"
          onChange={(event) => {
            const amount = Number(event.target.value);
            const previous = draft.product.price;
            update({
              ...draft,
              product: {
                ...draft.product,
                price: {
                  original: previous?.original ?? null,
                  confirmed: {
                    amount: Number.isFinite(amount) ? amount : 0,
                    currency: previous?.confirmed?.currency ?? "JPY",
                  },
                },
              },
            } as CandidateDraft);
          }}
          value={draft.product.price?.confirmed?.amount ?? ""}
        />
      </label>
      <label>
        カテゴリ
        <select
          name="candidate-category"
          onChange={(event) =>
            update(changeCategory(draft, event.target.value as PartCategory))
          }
          value={draft.category}
        >
          {PART_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {categoryLabels[category]}
            </option>
          ))}
        </select>
      </label>
      {editableAttributes(draft.category).map((field) => {
        const value = attributeValues[field.key];
        const confirmed = value?.confirmed;
        return (
          <label key={field.key}>
            {field.label}
            <input
              name={`attribute-${field.key}`}
              onChange={(event) => setAttribute(field, event.target.value)}
              value={
                Array.isArray(confirmed)
                  ? confirmed.join(", ")
                  : (confirmed ?? value?.original ?? "")
              }
            />
          </label>
        );
      })}
      <label>
        取得元URL
        <input
          name="candidate-source-url"
          onChange={(event) =>
            update({
              ...draft,
              sourceInfo: { ...draft.sourceInfo, pageUrl: event.target.value },
            })
          }
          value={draft.sourceInfo?.pageUrl ?? ""}
        />
      </label>
      <label>
        取得日時
        <input
          name="candidate-captured-at"
          onChange={(event) =>
            update({
              ...draft,
              sourceInfo: {
                ...draft.sourceInfo,
                capturedAt: event.target.value as UtcTimestamp,
              },
            })
          }
          value={draft.sourceInfo?.capturedAt ?? ""}
        />
      </label>
      <label>
        取得元表記
        <textarea
          name="candidate-source-snapshot"
          readOnly
          value={JSON.stringify(draft.sourceSnapshot ?? {}, null, 2)}
        />
      </label>
      {state.value.displayError?.code === "validation" ? (
        <p role="alert">入力内容を確認してください</p>
      ) : null}
      {state.value.displayError === null ? null : state.value.displayError
          .code === "validation" ? null : (
        <p role="alert">保存に失敗しました。もう一度お試しください。</p>
      )}
      <button
        disabled={state.value.isSaving || state.value.mutationsDisabled}
        type="submit"
      >
        保存
      </button>
      <button
        disabled={state.value.isSaving}
        onClick={() => {
          state.cancelEditor();
          rerender();
        }}
        type="button"
      >
        キャンセル
      </button>
    </form>
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
  const confirmDeletion = async () => {
    await state.confirmDeletion();
    rerender();
  };
  const deletionTarget = (() => {
    const deletion = value.deletion;
    if (deletion === null) return null;
    if (deletion.kind === "project") {
      const project = value.projects.find(
        (item) => item.id === deletion.projectId,
      );
      return project === undefined
        ? null
        : { kind: "project" as const, name: project.name };
    }
    const candidate = value.candidates.find(
      (item) => item.id === deletion.candidateId,
    );
    return candidate === undefined
      ? null
      : { kind: "candidate" as const, name: displayValue(candidate.name) };
  })();

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
            <button
              data-delete-project-id={project.id}
              disabled={value.isSaving || value.mutationsDisabled}
              onClick={() => {
                state.requestDeletion({
                  kind: "project",
                  projectId: project.id,
                });
                rerender();
              }}
              type="button"
            >
              削除
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
          <CandidateListItem
            candidate={candidate}
            key={candidate.id}
            onDelete={() => {
              state.requestDeletion({
                kind: "candidate",
                candidateId: candidate.id,
              });
              rerender();
            }}
          />
        ))}
      </ul>
      {deletionTarget === null ? null : (
        <section aria-label="削除確認" role="dialog">
          <h2>削除を確認</h2>
          {deletionTarget.kind === "project" ? (
            <p>
              プロジェクト「{deletionTarget.name}」と所属する候補も削除します。
            </p>
          ) : (
            <p>候補「{deletionTarget.name}」を削除します。</p>
          )}
          {value.displayError === null ? null : (
            <p role="alert">保存に失敗しました。もう一度お試しください。</p>
          )}
          <button
            data-confirm-deletion
            disabled={value.isSaving || value.mutationsDisabled}
            onClick={() => void confirmDeletion()}
            type="button"
          >
            削除する
          </button>
          <button
            data-cancel-deletion
            disabled={value.isSaving}
            onClick={() => {
              state.cancelDeletion();
              rerender();
            }}
            type="button"
          >
            取消
          </button>
        </section>
      )}
      <CandidateEditorForm state={state} />
    </section>
  );
}
