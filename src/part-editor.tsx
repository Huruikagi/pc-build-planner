/**
 * パーツ編集。デザインキャンバス「5. パーツ編集」に対応する。
 *
 * 一覧を置き換えて開く (`changes.md` C-2-3)。編集対象は確認済みの値だけで、
 * v0.4.0 のような生 JSON のテキストエリアは持たない (C-2-2)。
 */
import { useState } from "react";

import { t } from "./i18n.js";
import {
  CATEGORY_ATTRIBUTES,
  formatMoney,
  MOTHERBOARD_FORM_FACTORS,
  PART_CATEGORIES,
  type PartCategory,
  POWER_SUPPLY_FORM_FACTORS,
} from "./model.js";
import type { IdentityField, PartDraft } from "./parts.js";

const categoryLabel = (category: PartCategory): string =>
  t(`category_${category.replace("-", "_")}`);

const attributeLabel = (key: string): string => t(`attribute_${key}`);

const labelKeyFor = (field: IdentityField): string =>
  field === "name"
    ? "fieldName"
    : field === "manufacturer"
      ? "fieldManufacturer"
      : "fieldModelNumber";

/** 既知規格のある属性だけ入力候補を出す。選択肢の強制はしない。 */
const suggestionsFor = (key: string): readonly string[] => {
  if (key === "supportedMotherboardFormFactors")
    return MOTHERBOARD_FORM_FACTORS;
  if (key === "formFactor") return POWER_SUPPLY_FORM_FACTORS;
  if (key === "supportedPowerSupplyFormFactors")
    return POWER_SUPPLY_FORM_FACTORS;
  return [];
};

interface PartEditorProps {
  readonly draft: PartDraft;
  readonly onChange: (draft: PartDraft) => void;
  readonly onSave: (draft: PartDraft) => void;
  readonly onCancel: () => void;
}

export const PartEditor = ({
  draft,
  onChange,
  onSave,
  onCancel,
}: PartEditorProps) => {
  const [nameError, setNameError] = useState(false);
  const [showOriginals, setShowOriginals] = useState(false);

  const attributes = CATEGORY_ATTRIBUTES[draft.category];
  const originals = Object.entries(draft.originals).filter(
    (entry): entry is [IdentityField, string] => entry[1] !== undefined,
  );

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (draft.name.trim() === "") {
      setNameError(true);
      return;
    }
    onSave(draft);
  };

  return (
    <form data-part-editor onSubmit={submit}>
      <div className="editor-bar">
        <button className="editor-bar__back" onClick={onCancel} type="button">
          {t("backToList")}
        </button>
        <span className="editor-bar__title">
          {draft.id === null ? t("partAdd") : t("partEditTitle")}
        </span>
      </div>

      <div className="section-header">
        <span>{t("editorBasics")}</span>
      </div>

      <div className="field-row">
        <label className="field-row__label" htmlFor="part-name">
          {t("fieldName")} <span className="field-row__required">*</span>
        </label>
        <input
          className="field"
          id="part-name"
          name="part-name"
          onChange={(event) => {
            onChange({ ...draft, name: event.target.value });
            setNameError(false);
          }}
          value={draft.name}
        />
      </div>
      {nameError ? (
        <div className="error-text" role="alert">
          {t("partNameRequired")}
        </div>
      ) : null}

      <div className="field-row">
        <label className="field-row__label" htmlFor="part-manufacturer">
          {t("fieldManufacturer")}
        </label>
        <input
          className="field"
          id="part-manufacturer"
          name="part-manufacturer"
          onChange={(event) =>
            onChange({ ...draft, manufacturer: event.target.value })
          }
          placeholder={t("notEntered")}
          value={draft.manufacturer}
        />
      </div>

      <div className="field-row">
        <label className="field-row__label" htmlFor="part-model-number">
          {t("fieldModelNumber")}
        </label>
        <input
          className="field field--mono"
          id="part-model-number"
          name="part-model-number"
          onChange={(event) =>
            onChange({ ...draft, modelNumber: event.target.value })
          }
          placeholder={t("notEntered")}
          value={draft.modelNumber}
        />
      </div>

      <div className="field-row field-row--last">
        <label className="field-row__label" htmlFor="part-category">
          {t("fieldCategory")}
        </label>
        <select
          className="field"
          id="part-category"
          name="part-category"
          onChange={(event) =>
            onChange({
              ...draft,
              category: event.target.value as PartCategory,
            })
          }
          value={draft.category}
        >
          {PART_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {categoryLabel(category)}
            </option>
          ))}
        </select>
      </div>

      {attributes.length > 0 ? (
        <>
          <div className="section-header">
            <span>{t("editorSpecs", categoryLabel(draft.category))}</span>
            <span className="section-header__note">{t("editorSpecsNote")}</span>
          </div>
          {attributes.map((definition) => {
            const value = draft.attributes[definition.key] ?? "";
            const suggestions = suggestionsFor(definition.key);
            const listId = `suggest-${definition.key}`;
            return (
              <div className="field-row" key={definition.key}>
                <label
                  className="field-row__label"
                  htmlFor={`attribute-${definition.key}`}
                >
                  {attributeLabel(definition.key)}
                </label>
                <input
                  className={
                    value === ""
                      ? "field field--mono field--unconfirmed"
                      : "field field--mono"
                  }
                  id={`attribute-${definition.key}`}
                  list={suggestions.length > 0 ? listId : undefined}
                  name={`attribute-${definition.key}`}
                  onChange={(event) =>
                    onChange({
                      ...draft,
                      attributes: {
                        ...draft.attributes,
                        [definition.key]: event.target.value,
                      },
                    })
                  }
                  placeholder={
                    definition.kind === "list"
                      ? t("attributeListHint")
                      : t("notEntered")
                  }
                  value={value}
                />
                {suggestions.length > 0 ? (
                  <datalist id={listId}>
                    {suggestions.map((entry) => (
                      <option key={entry} value={entry} />
                    ))}
                  </datalist>
                ) : null}
              </div>
            );
          })}
          {/* 欠損は異常ではない。保存を拒まないことを入力の場で先に伝える。 */}
          <p className="field-note">{t("editorSpecsOptional")}</p>
        </>
      ) : null}

      <div className="section-header">
        <span>{t("editorSources")}</span>
        <span>{draft.sources.length}</span>
      </div>

      {draft.sources.length === 0 ? (
        <div className="placeholder">{t("editorSourcesEmpty")}</div>
      ) : (
        draft.sources.map((source) => (
          <div
            className={
              source.primary ? "source-row source-row--primary" : "source-row"
            }
            key={source.id}
          >
            <div className="source-row__head">
              {source.primary ? (
                <span className="badge badge--primary">
                  {t("sourcePrimary")}
                </span>
              ) : null}
              <span className="source-row__kind">
                {t(`sourceKind_${source.kind}`)}
              </span>
              <span className="source-row__price">
                {source.price === null
                  ? t("sourceNoPrice")
                  : formatMoney(source.price)}
              </span>
            </div>
            <a
              className="source-row__url"
              href={source.url}
              rel="noreferrer"
              target="_blank"
            >
              {source.url}
            </a>
            <div className="source-row__captured">
              {t("sourceCapturedAt", source.capturedAt)}
            </div>
          </div>
        ))
      )}

      {/*
        取り込み時の元表記。**読み取り専用** (`changes.md` C-2-2)。
        v0.4.0 は生 JSON のテキストエリアとして露出していた。
        編集対象は確認済みの値だけで、元表記は参照するだけのもの。
      */}
      {originals.length === 0 ? null : (
        <>
          <button
            aria-expanded={showOriginals}
            className="disclosure"
            data-originals-toggle
            onClick={() => setShowOriginals((open) => !open)}
            type="button"
          >
            {t("editorOriginals")}
          </button>
          {showOriginals ? (
            <dl className="originals">
              {originals.map(([field, original]) => (
                <div className="originals__row" key={field}>
                  <dt>{t(labelKeyFor(field))}</dt>
                  <dd>{original}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </>
      )}

      <div className="editor-actions">
        <button className="button button--primary" type="submit">
          {t("save")}
        </button>
        <button className="button" onClick={onCancel} type="button">
          {t("cancel")}
        </button>
      </div>
    </form>
  );
};
