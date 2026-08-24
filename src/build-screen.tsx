/**
 * 現在構成。デザインキャンバス「2. 現在構成」に対応する。
 *
 * 上が採用中の構成表、下が選択中カテゴリの候補から採用する一覧。
 *
 * 数量はフォーカスを外した時点（および Enter）で確定する。確定ボタンは
 * 持たない (`docs/reverse/changes.md` C-6)。「未保存の数量」という状態が
 * 無いので、切替時の確認も隔離保持も要らない。
 */
import { useMemo, useRef, useState } from "react";

import {
  adoptPart,
  type BuildRow,
  buildOf,
  buildRows,
  buildTotal,
  parseQuantity,
  releasePart,
  setQuantity,
} from "./build.js";
import { t } from "./i18n.js";
import { CloseIcon } from "./icons.js";
import {
  formatMoney,
  PART_CATEGORIES,
  type PartCategory,
  primarySource,
} from "./model.js";
import { partsOf } from "./parts.js";
import type { ScreenProps } from "./screen-props.js";

const categoryLabel = (category: PartCategory): string =>
  t(`category_${category.replace("-", "_")}`);

/** 未選択のカテゴリは既定で畳む。1 画面に収める方が比較しやすい。 */
const VISIBLE_EMPTY_ROWS = 4;

interface QuantityFieldProps {
  readonly partId: string;
  readonly quantity: number;
  readonly onCommit: (quantity: number) => void;
}

const QuantityField = ({ partId, quantity, onCommit }: QuantityFieldProps) => {
  const [raw, setRaw] = useState(String(quantity));
  const [invalid, setInvalid] = useState(false);

  /** 確定できない値は保存せず、直前の確定値へ戻す (`changes.md` C-6)。 */
  const commit = () => {
    const parsed = parseQuantity(raw);
    if (parsed === null) {
      setRaw(String(quantity));
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (parsed !== quantity) onCommit(parsed);
  };

  return (
    <>
      <input
        aria-label={t("buildQuantity")}
        className={invalid ? "quantity quantity--invalid" : "quantity"}
        data-quantity-for={partId}
        inputMode="numeric"
        onBlur={commit}
        onChange={(event) => {
          setRaw(event.target.value);
          setInvalid(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        value={raw}
      />
      {invalid ? (
        <span className="quantity__error" role="alert">
          {t("buildQuantityInvalid")}
        </span>
      ) : null}
    </>
  );
};

/**
 * 表のカテゴリ名は、下の候補一覧のカテゴリを切り替えるボタンでもある。
 * 「未選択」の行から、そのカテゴリの候補へ直接降りられる導線が要る。
 */
const CategoryButton = ({
  category,
  selected,
  onSelect,
}: {
  readonly category: PartCategory;
  readonly selected: boolean;
  readonly onSelect: (category: PartCategory) => void;
}) => (
  <button
    aria-label={t("buildShowCandidates", categoryLabel(category))}
    aria-pressed={selected}
    className="build-row__category"
    data-select-category={category}
    onClick={() => onSelect(category)}
    type="button"
  >
    {categoryLabel(category)}
  </button>
);

const AdoptedRow = ({
  row,
  selected,
  onQuantity,
  onRelease,
  onSelect,
}: {
  readonly row: BuildRow;
  readonly selected: boolean;
  readonly onQuantity: (partId: string, quantity: number) => void;
  readonly onRelease: (partId: string) => void;
  readonly onSelect: (category: PartCategory) => void;
}) => (
  <>
    {row.entries.map(({ part, quantity }) => {
      const price = primarySource(part)?.price ?? null;
      return (
        <li className="build-row" data-adopted-id={part.id} key={part.id}>
          <CategoryButton
            category={row.category}
            onSelect={onSelect}
            selected={selected}
          />
          <span className="build-row__name">{part.name}</span>
          <QuantityField
            onCommit={(next) => onQuantity(part.id, next)}
            partId={part.id}
            quantity={quantity}
          />
          <span className="build-row__price">
            {price === null
              ? "—"
              : formatMoney({
                  amount: price.amount * quantity,
                  currency: price.currency,
                })}
          </span>
          <button
            aria-label={t("buildRelease", part.name)}
            className="project-menu__icon-button"
            data-release-part={part.id}
            onClick={() => onRelease(part.id)}
            type="button"
          >
            <CloseIcon />
          </button>
        </li>
      );
    })}
  </>
);

export const BuildScreen = ({ root, project, apply }: ScreenProps) => {
  const [category, setCategory] = useState<PartCategory>("cpu");
  const [showEmpty, setShowEmpty] = useState(false);
  const adoptRef = useRef<HTMLDivElement>(null);

  /** 候補一覧は表より下にある。切り替えた結果が視界に入るまで送る。 */
  const selectCategory = (next: PartCategory) => {
    setCategory(next);
    adoptRef.current?.scrollIntoView({ block: "nearest" });
  };

  const rows = useMemo(
    () => buildRows(root, project?.id ?? null),
    [root, project],
  );
  const parts = useMemo(
    () => partsOf(root, project?.id ?? null),
    [root, project],
  );
  const build = buildOf(root, project?.id ?? null);
  const adoptedIds = new Set((build?.items ?? []).map((item) => item.partId));

  if (project === null)
    return (
      <>
        <div className="section-header">
          <span>{t("buildTitle")}</span>
        </div>
        <div className="placeholder">{t("projectEmpty")}</div>
      </>
    );

  const projectId = project.id;
  const filled = rows.filter((row) => row.entries.length > 0);
  const empty = rows.filter((row) => row.entries.length === 0);
  const visibleEmpty = showEmpty ? empty : empty.slice(0, VISIBLE_EMPTY_ROWS);
  const total = buildTotal(rows);
  const candidates = parts.filter((part) => part.category === category);

  return (
    <>
      <div className="section-header">
        <span>{t("buildAdopted")}</span>
        <span>
          {t("buildCategoryRatio", String(filled.length), String(rows.length))}
        </span>
      </div>

      {filled.length === 0 && build === null ? (
        <div className="placeholder">{t("buildEmpty")}</div>
      ) : null}

      <ul className="build-list">
        {filled.map((row) => (
          <AdoptedRow
            key={row.category}
            onQuantity={(partId, quantity) =>
              apply(setQuantity(projectId, partId, quantity))
            }
            onRelease={(partId) => apply(releasePart(projectId, partId))}
            onSelect={selectCategory}
            row={row}
            selected={row.category === category}
          />
        ))}
        {visibleEmpty.map((row) => (
          <li className="build-row build-row--empty" key={row.category}>
            <CategoryButton
              category={row.category}
              onSelect={selectCategory}
              selected={row.category === category}
            />
            <span className="build-row__name build-row__name--empty">
              {t("buildUnselected")}
            </span>
            <span className="build-row__price">—</span>
          </li>
        ))}
      </ul>

      {empty.length > VISIBLE_EMPTY_ROWS ? (
        <button
          className="disclosure disclosure--center"
          data-toggle-empty
          onClick={() => setShowEmpty((open) => !open)}
          type="button"
        >
          {showEmpty
            ? t("buildHideUnselected")
            : t(
                "buildShowUnselected",
                String(empty.length - VISIBLE_EMPTY_ROWS),
              )}
        </button>
      ) : null}

      {total === null ? null : (
        <div className="build-total">
          <span>{t("buildTotal")}</span>
          <span className="build-total__amount">{total.text}</span>
        </div>
      )}
      {total?.mixedCurrency === true ? (
        <p className="field-note">{t("buildMixedCurrency")}</p>
      ) : null}

      <div className="section-header" ref={adoptRef}>
        <span>{t("buildAdoptFrom")}</span>
        <select
          aria-label={t("fieldCategory")}
          className="section-header__select"
          data-adopt-category
          onChange={(event) => setCategory(event.target.value as PartCategory)}
          value={category}
        >
          {PART_CATEGORIES.map((entry) => (
            <option key={entry} value={entry}>
              {categoryLabel(entry)}
            </option>
          ))}
        </select>
      </div>

      {candidates.length === 0 ? (
        <div className="placeholder">{t("partsEmpty")}</div>
      ) : (
        <ul className="part-list">
          {candidates.map((part) => {
            const price = primarySource(part)?.price ?? null;
            const adopted = adoptedIds.has(part.id);
            return (
              <li
                className="part-row"
                data-candidate-id={part.id}
                key={part.id}
              >
                <span className="part-row__main">
                  <span className="part-row__name">{part.name}</span>
                  <span className="part-row__meta">
                    {part.manufacturer?.confirmed ??
                      categoryLabel(part.category)}
                  </span>
                </span>
                <span className="part-row__price">
                  {price === null ? "—" : formatMoney(price)}
                </span>
                <button
                  className="button"
                  data-adopt-part={part.id}
                  disabled={adopted}
                  onClick={() => apply(adoptPart(projectId, part.id))}
                  type="button"
                >
                  {adopted ? t("buildAdoptedLabel") : t("buildAdopt")}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
};
