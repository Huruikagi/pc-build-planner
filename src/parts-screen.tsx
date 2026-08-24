/**
 * パーツ管理。デザインキャンバス「1. パーツ管理」に対応する。
 *
 * カード形式ではなく 1 パーツ 1 行の表形式にしている (`changes.md` C-2-4)。
 * 未入力の項目は行に出さず、件数だけを添える。v0.4.0 は全項目を常に 5 行
 * 表示して候補 3 件で画面を使い切っていた。
 *
 * プロジェクトの CRUD はここに置かない (C-1)。ヘッダのポップオーバーが持つ。
 */
import { useEffect, useMemo, useState } from "react";

import { t } from "./i18n.js";
import { DeleteIcon, PlusIcon } from "./icons.js";
import {
  type CandidatePart,
  formatMoney,
  missingFieldCount,
  PART_CATEGORIES,
  type PartCategory,
  primarySource,
} from "./model.js";
import { PartEditor } from "./part-editor.js";
import {
  countByCategory,
  deletePart,
  draftFromPart,
  emptyDraft,
  type PartDraft,
  partsOf,
  savePart,
} from "./parts.js";
import type { ScreenProps } from "./screens.js";

/** カテゴリの短い列見出し。等幅の規格列と揃うよう表記を切り詰める。 */
const categoryLabel = (category: PartCategory): string =>
  t(`category_${category.replace("-", "_")}`);

const attributeSummary = (part: CandidatePart): readonly string[] => {
  const values: string[] = [];
  for (const value of Object.values(part.attributes)) {
    const { confirmed } = value;
    if (confirmed === undefined) continue;
    if (Array.isArray(confirmed)) values.push(...confirmed);
    else values.push(confirmed);
  }
  return values;
};

export const PartsScreen = ({
  root,
  project,
  apply,
  handoff,
  onHandoffConsumed,
}: ScreenProps) => {
  const [category, setCategory] = useState<PartCategory | "all">("all");
  const [draft, setDraft] = useState<PartDraft | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  /** 取り込みからの引き渡しは、届いた時点で編集面を開く。 */
  useEffect(() => {
    if (handoff === null) return;
    setDraft(handoff);
    onHandoffConsumed();
  }, [handoff, onHandoffConsumed]);

  const parts = useMemo(
    () => partsOf(root, project?.id ?? null),
    [root, project],
  );
  const counts = useMemo(() => countByCategory(parts), [parts]);
  const visible = useMemo(
    () =>
      category === "all" ? parts : parts.filter((p) => p.category === category),
    [parts, category],
  );

  if (project === null)
    return (
      <>
        <div className="section-header">
          <span>{t("partsTitle")}</span>
        </div>
        <div className="placeholder">{t("projectEmpty")}</div>
      </>
    );

  /**
   * 編集は一覧の下ではなく一覧を置き換えて開く (`changes.md` C-2-3)。
   * v0.4.0 は候補 3 件で着地点が 1,100px 下 = 画面外だった。
   */
  if (draft !== null)
    return (
      <PartEditor
        draft={draft}
        onCancel={() => setDraft(null)}
        onChange={setDraft}
        onSave={(next) => {
          apply(savePart(next, project.id));
          setDraft(null);
        }}
      />
    );

  const total = parts.reduce((sum, part) => {
    const price = primarySource(part)?.price;
    return price == null ? sum : sum + price.amount;
  }, 0);
  const currency = parts
    .map((part) => primarySource(part)?.price?.currency)
    .find((value) => value !== undefined);

  return (
    <>
      <div className="filters" role="tablist">
        <button
          aria-selected={category === "all"}
          className="filters__item"
          data-category="all"
          onClick={() => setCategory("all")}
          role="tab"
          type="button"
        >
          {t("categoryAll")}
          <span className="filters__count">{parts.length}</span>
        </button>
        {PART_CATEGORIES.filter((entry) => (counts.get(entry) ?? 0) > 0).map(
          (entry) => (
            <button
              aria-selected={category === entry}
              className="filters__item"
              data-category={entry}
              key={entry}
              onClick={() => setCategory(entry)}
              role="tab"
              type="button"
            >
              {categoryLabel(entry)}
              <span className="filters__count">{counts.get(entry)}</span>
            </button>
          ),
        )}
      </div>

      <div className="section-header">
        <span>{t("partsColumnName")}</span>
        <span className="part-row__spec-header">{t("partsColumnSpec")}</span>
        <span className="part-row__price-header">{t("partsColumnPrice")}</span>
      </div>

      {visible.length === 0 ? (
        <div className="placeholder">{t("partsEmpty")}</div>
      ) : (
        <ul aria-label={t("partsTitle")} className="part-list">
          {visible.map((part) => {
            const missing = missingFieldCount(part);
            const price = primarySource(part)?.price ?? null;
            const specs = attributeSummary(part);

            if (confirmingId === part.id)
              return (
                <li className="part-row part-row--confirm" key={part.id}>
                  <div>{t("partDeleteConfirm", part.name)}</div>
                  <div className="project-menu__confirm-actions">
                    <button
                      className="button button--danger"
                      data-confirm-delete
                      onClick={() => {
                        apply(deletePart(part.id));
                        setConfirmingId(null);
                      }}
                      type="button"
                    >
                      {t("projectDeleteAction")}
                    </button>
                    <button
                      className="button"
                      onClick={() => setConfirmingId(null)}
                      type="button"
                    >
                      {t("cancel")}
                    </button>
                  </div>
                </li>
              );

            return (
              <li className="part-row" data-part-id={part.id} key={part.id}>
                <button
                  aria-label={t("partEdit", part.name)}
                  className="part-row__main"
                  data-edit-part
                  onClick={() => setDraft(draftFromPart(part))}
                  type="button"
                >
                  <span className="part-row__name">{part.name}</span>
                  <span className="part-row__meta">
                    {[
                      part.manufacturer?.confirmed,
                      categoryLabel(part.category),
                      part.sources.length > 1
                        ? t("partSourceCount", String(part.sources.length))
                        : undefined,
                    ]
                      .filter((entry) => entry !== undefined)
                      .join(" · ")}
                  </span>
                  {missing > 0 ? (
                    <span className="part-row__missing">
                      {t("partMissingFields", String(missing))}
                    </span>
                  ) : null}
                </button>
                <span className="part-row__spec">
                  {specs.length === 0 ? "—" : specs.join(" ")}
                </span>
                <span className="part-row__price">
                  {price === null ? "—" : formatMoney(price)}
                </span>
                <button
                  aria-label={t("partDelete", part.name)}
                  className="project-menu__icon-button"
                  data-delete-part
                  onClick={() => setConfirmingId(part.id)}
                  type="button"
                >
                  <DeleteIcon />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="part-list__footer">
        <span>{t("partsCount", String(parts.length))}</span>
        {currency === undefined ? null : (
          <span className="part-list__total">
            {t("partsTotal", formatMoney({ amount: total, currency }))}
          </span>
        )}
      </div>

      <div className="part-list__add">
        <button
          className="button button--primary button--wide"
          data-create-part
          onClick={() => setDraft(emptyDraft())}
          type="button"
        >
          <PlusIcon />
          {t("partAdd")}
        </button>
      </div>
    </>
  );
};
