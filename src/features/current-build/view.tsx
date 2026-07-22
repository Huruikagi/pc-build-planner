import { useState, useSyncExternalStore } from "react";

import {
  type CandidatePartId,
  PART_CATEGORIES,
  type PartCategory,
} from "../../domain/public.js";
import { createCategoryPolicy, isValidQuantity } from "./category-policy.js";
import type { BuildDisplayError, BuildState } from "./state.js";

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

/** Uncategorized candidates are never build-eligible, so the tab never applies. */
const selectableCategories = PART_CATEGORIES.filter(
  (category) => category !== "uncategorized",
);

const errorMessages: Readonly<Record<BuildDisplayError["code"], string>> = {
  validation: "入力内容を確認してください。",
  "not-found": "対象の候補が見つかりませんでした。読み込み直してください。",
  conflict:
    "他の変更と競合しました。最新の内容を読み込んでからもう一度お試しください。",
  maintenance: "保守操作の実行中です。完了後にもう一度お試しください。",
  "corrupt-data": "保存データが破損しています。既存データは変更していません。",
  "unsupported-data":
    "保存データが対応していない形式です。既存データは変更していません。",
  quota:
    "保存容量が不足しています。不要な候補を削除してからもう一度お試しください。",
  storage:
    "保存領域を利用できません。拡張機能を開き直してからもう一度お試しください。",
  "snapshot-restore-failed": "前回の画面状態を復元できませんでした。",
};

const policy = createCategoryPolicy();

const displayName = (candidate: {
  readonly product: {
    readonly name?: {
      readonly original: string | null;
      readonly confirmed?: string;
    };
  };
}): string =>
  candidate.product.name?.confirmed ??
  candidate.product.name?.original ??
  "未入力";

/** Renders feature-owned state without moving domain state into React hooks. */
export function BuildView({ state }: { readonly state: BuildState }) {
  useSyncExternalStore(
    (listener) => state.subscribe(listener),
    () => state.value,
    () => state.value,
  );
  const [quantityErrors, setQuantityErrors] = useState<
    Readonly<Record<string, string>>
  >({});
  const value = state.value;
  const disabled = value.isSaving || value.mutationsDisabled;
  const itemsByCandidate = new Map(
    (value.currentBuild?.items ?? []).map((item) => [
      item.candidatePartId,
      item,
    ]),
  );

  const select = (candidatePartId: CandidatePartId) => {
    if (value.selectedProjectId === null) return;
    void state.execute({
      type: "select",
      projectId: value.selectedProjectId,
      candidatePartId,
    });
  };
  const remove = (candidatePartId: CandidatePartId) => {
    if (value.selectedProjectId === null) return;
    void state.execute({
      type: "remove",
      projectId: value.selectedProjectId,
      candidatePartId,
    });
  };
  const confirmQuantity = (candidatePartId: CandidatePartId) => {
    if (value.selectedProjectId === null) return;
    const draft = value.quantityDrafts[candidatePartId];
    const parsed = Number(draft);
    if (!isValidQuantity("multiple", parsed)) {
      setQuantityErrors((current) => ({
        ...current,
        [candidatePartId]: "正整数を入力してください",
      }));
      return;
    }
    setQuantityErrors((current) => {
      const { [candidatePartId]: _removed, ...rest } = current;
      return rest;
    });
    void state.execute({
      type: "set-quantity",
      projectId: value.selectedProjectId,
      candidatePartId,
      quantity: parsed,
    });
  };

  return (
    <section aria-label="現在構成" className="current-build">
      <nav aria-label="プロジェクト">
        {value.projects.map((project) => (
          <button
            aria-current={
              project.id === value.selectedProjectId ? "page" : undefined
            }
            data-project-id={project.id}
            disabled={disabled}
            key={project.id}
            onClick={() => void state.selectProject(project.id)}
            type="button"
          >
            {project.name}
          </button>
        ))}
      </nav>
      <nav aria-label="カテゴリ">
        {selectableCategories.map((category) => (
          <button
            aria-current={
              category === value.selectedCategory ? "page" : undefined
            }
            data-category={category}
            key={category}
            onClick={() => state.selectCategory(category)}
            type="button"
          >
            {categoryLabels[category]}
          </button>
        ))}
      </nav>
      {value.candidates.length === 0 ? (
        <p>候補がありません</p>
      ) : (
        <ul aria-label="候補一覧">
          {value.candidates.map((candidate) => {
            const mode = policy.modeFor(candidate.category);
            const item = itemsByCandidate.get(candidate.id);
            const name = displayName(candidate);
            const quantityError = quantityErrors[candidate.id];

            if (mode !== "multiple") {
              return (
                <li key={candidate.id}>
                  <span>{name}</span>
                  {item === undefined ? (
                    <button
                      data-select-candidate-id={candidate.id}
                      disabled={disabled}
                      onClick={() => select(candidate.id)}
                      type="button"
                    >
                      選択
                    </button>
                  ) : (
                    <button
                      data-remove-candidate-id={candidate.id}
                      disabled={disabled}
                      onClick={() => remove(candidate.id)}
                      type="button"
                    >
                      解除
                    </button>
                  )}
                </li>
              );
            }

            return (
              <li key={candidate.id}>
                <span>{name}</span>
                {item === undefined ? (
                  <button
                    data-select-candidate-id={candidate.id}
                    disabled={disabled}
                    onClick={() => select(candidate.id)}
                    type="button"
                  >
                    追加
                  </button>
                ) : (
                  <>
                    <input
                      aria-describedby={
                        quantityError === undefined
                          ? undefined
                          : `quantity-error-${candidate.id}`
                      }
                      aria-invalid={
                        quantityError === undefined ? undefined : true
                      }
                      data-quantity-input={candidate.id}
                      disabled={disabled}
                      inputMode="numeric"
                      onChange={(event) =>
                        state.setQuantityDraft(candidate.id, event.target.value)
                      }
                      value={
                        value.quantityDrafts[candidate.id] ??
                        String(item.quantity)
                      }
                    />
                    <button
                      data-confirm-quantity={candidate.id}
                      disabled={disabled}
                      onClick={() => confirmQuantity(candidate.id)}
                      type="button"
                    >
                      数量を確定
                    </button>
                    {quantityError === undefined ? null : (
                      <p id={`quantity-error-${candidate.id}`} role="alert">
                        {quantityError}
                      </p>
                    )}
                    <button
                      data-remove-candidate-id={candidate.id}
                      disabled={disabled}
                      onClick={() => remove(candidate.id)}
                      type="button"
                    >
                      解除
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {value.currentBuild === null ? <p>現在構成がありません</p> : null}
      {value.displayError === null ? null : (
        <p role="alert">{errorMessages[value.displayError.code]}</p>
      )}
    </section>
  );
}
