/**
 * 既存パーツとの一致確認。`docs/reverse/features.md` 3 章に対応する。
 *
 * 提示するのは**排他 2 択**（新しいパーツとして保存 / 選択したパーツへ統合）。
 * 一致の根拠と確信度を示したうえで、決めるのは利用者。勝手に統合しない。
 */
import { useState } from "react";

import type { DuplicateMatch } from "./duplicates.js";
import { t } from "./i18n.js";
import type { PartCategory } from "./model.js";

const categoryLabel = (category: PartCategory): string =>
  t(`category_${category.replace("-", "_")}`);

interface DuplicateChoiceProps {
  readonly matches: readonly DuplicateMatch[];
  readonly onSaveNew: () => void;
  readonly onMerge: (targetId: string) => void;
  readonly onBack: () => void;
}

export const DuplicateChoice = ({
  matches,
  onSaveNew,
  onMerge,
  onBack,
}: DuplicateChoiceProps) => {
  const [selectedId, setSelectedId] = useState(matches[0]?.part.id ?? null);

  return (
    <div data-duplicate-choice>
      <div className="editor-bar">
        <button className="editor-bar__back" onClick={onBack} type="button">
          {t("backToEditor")}
        </button>
        <span className="editor-bar__title">{t("duplicateTitle")}</span>
      </div>

      <p className="field-note field-note--wide">{t("duplicateDescription")}</p>

      <div className="section-header">
        <span>{t("duplicateCandidates")}</span>
        <span>{matches.length}</span>
      </div>

      {matches.map((match) => (
        <label
          className={
            selectedId === match.part.id
              ? "duplicate-row duplicate-row--selected"
              : "duplicate-row"
          }
          key={match.part.id}
        >
          <input
            checked={selectedId === match.part.id}
            className="duplicate-row__radio"
            data-duplicate-option={match.part.id}
            name="duplicate-target"
            onChange={() => setSelectedId(match.part.id)}
            type="radio"
          />
          <span className="duplicate-row__body">
            <span className="duplicate-row__name">{match.part.name}</span>
            <span className="duplicate-row__meta">
              {[
                match.part.manufacturer?.confirmed,
                categoryLabel(match.part.category),
              ]
                .filter((entry) => entry !== undefined)
                .join(" · ")}
            </span>
            <span className="duplicate-row__evidence">
              <span className={`badge badge--${match.confidence}`}>
                {t(`duplicateConfidence_${match.confidence}`)}
              </span>
              {t(`duplicateEvidence_${match.evidence}`)}
            </span>
          </span>
        </label>
      ))}

      <div className="editor-actions editor-actions--stacked">
        <button
          className="button button--primary button--wide"
          data-duplicate-merge
          disabled={selectedId === null}
          onClick={() => {
            if (selectedId !== null) onMerge(selectedId);
          }}
          type="button"
        >
          {t("duplicateMerge")}
        </button>
        <button
          className="button button--wide"
          data-duplicate-save-new
          onClick={onSaveNew}
          type="button"
        >
          {t("duplicateSaveNew")}
        </button>
      </div>

      <p className="field-note field-note--wide">{t("duplicateMergeNote")}</p>
    </div>
  );
};
