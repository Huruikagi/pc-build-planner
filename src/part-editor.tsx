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
  type CandidateSource,
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

const parseList = (raw: string): string[] =>
  raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");

interface ChoiceListFieldProps {
  readonly attributeKey: string;
  readonly choices: readonly string[];
  readonly value: string;
  readonly onChange: (value: string) => void;
}

/**
 * 複数選ぶ規格の入力。既知の規格はその場で選べるようにして、カンマ区切りの
 * 手入力を強いない。既知の一覧に無い値は「その他」として手入力で残せる。
 * 選択肢を強制しないという方針は変えていない (`features.md` 1.3)。
 */
const ChoiceListField = ({
  attributeKey,
  choices,
  value,
  onChange,
}: ChoiceListFieldProps) => {
  const entries = parseList(value);
  const selected = choices.filter((choice) => entries.includes(choice));
  /* 既知の選択肢に無い値。取り込んだ表記を捨てないよう手入力として残す。 */
  const [extra, setExtra] = useState(() =>
    entries.filter((entry) => !choices.includes(entry)).join(", "),
  );

  const compose = (nextSelected: readonly string[], nextExtra: string) =>
    [...nextSelected, ...parseList(nextExtra)].join(", ");

  const toggle = (choice: string, on: boolean) =>
    onChange(
      compose(
        choices.filter((entry) =>
          entry === choice ? on : selected.includes(entry),
        ),
        extra,
      ),
    );

  return (
    <fieldset className="field-row field-row--choices">
      <legend className="field-row__label">
        {attributeLabel(attributeKey)}
      </legend>
      <div className="choices">
        {choices.map((choice) => (
          <label className="choice" key={choice}>
            <input
              checked={selected.includes(choice)}
              className="choice__input"
              name={`attribute-${attributeKey}`}
              onChange={(event) => toggle(choice, event.target.checked)}
              type="checkbox"
              value={choice}
            />
            <span className="choice__box">{choice}</span>
          </label>
        ))}
        <input
          aria-label={t("attributeOther")}
          className={
            value === ""
              ? "choices__extra field field--mono field--unconfirmed"
              : "choices__extra field field--mono"
          }
          name={`attribute-${attributeKey}-extra`}
          onChange={(event) => {
            setExtra(event.target.value);
            onChange(compose(selected, event.target.value));
          }}
          placeholder={t("attributeOtherHint")}
          value={extra}
        />
      </div>
    </fieldset>
  );
};

const isHttpUrl = (value: string): boolean => {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
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
  const [sourceUrlError, setSourceUrlError] = useState(false);
  const [sourcePriceError, setSourcePriceError] = useState(false);
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
    if (draft.sources.some((source) => !isHttpUrl(source.url.trim()))) {
      setSourceUrlError(true);
      return;
    }
    if (
      draft.sources.some(
        (source) =>
          source.price !== null &&
          (!Number.isFinite(source.price.amount) ||
            source.price.amount < 0 ||
            source.price.currency.trim() === ""),
      )
    ) {
      setSourcePriceError(true);
      return;
    }
    onSave(draft);
  };

  const updateSource = (
    id: string,
    update: (source: CandidateSource) => CandidateSource,
  ) =>
    onChange({
      ...draft,
      sources: draft.sources.map((source) =>
        source.id === id ? update(source) : source,
      ),
    });

  const addSource = () => {
    const source: CandidateSource = {
      id: crypto.randomUUID(),
      url: "",
      kind: "retail",
      capturedAt: new Date().toISOString(),
      price: null,
      primary: !draft.sources.some((existing) => existing.primary),
    };
    onChange({ ...draft, sources: [...draft.sources, source] });
  };

  const removeSource = (id: string) => {
    const remaining = draft.sources.filter((source) => source.id !== id);
    const primaryStillExists = remaining.some((source) => source.primary);
    onChange({
      ...draft,
      sources: remaining.map((source, index) =>
        primaryStillExists || index !== 0
          ? source
          : { ...source, primary: true },
      ),
    });
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
          disabled={draft.modelNumberAbsent}
          id="part-model-number"
          name="part-model-number"
          onChange={(event) =>
            onChange({ ...draft, modelNumber: event.target.value })
          }
          placeholder={t("notEntered")}
          /* 入力は捨てずに伏せる。チェックを外せばそのまま戻る。 */
          value={draft.modelNumberAbsent ? "" : draft.modelNumber}
        />
        <label className="choice">
          <input
            checked={draft.modelNumberAbsent}
            className="choice__input"
            name="part-model-number-absent"
            onChange={(event) =>
              onChange({ ...draft, modelNumberAbsent: event.target.checked })
            }
            type="checkbox"
          />
          <span className="choice__box">{t("modelNumberAbsent")}</span>
        </label>
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
            const updateAttribute = (next: string) =>
              onChange({
                ...draft,
                attributes: { ...draft.attributes, [definition.key]: next },
              });
            /* 複数選ぶ規格は選択式にする。手入力しか無い状態を避ける。 */
            if (definition.kind === "list" && suggestions.length > 0)
              return (
                <ChoiceListField
                  attributeKey={definition.key}
                  choices={suggestions}
                  key={`${draft.id ?? "new"}-${draft.category}-${definition.key}`}
                  onChange={updateAttribute}
                  value={value}
                />
              );
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
                  onChange={(event) => updateAttribute(event.target.value)}
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
              <button
                className="button"
                data-source-remove={source.id}
                onClick={() => removeSource(source.id)}
                type="button"
              >
                {t("sourceRemove")}
              </button>
            </div>
            <div className="field-row source-row__field">
              <label
                className="field-row__label"
                htmlFor={`source-url-${source.id}`}
              >
                {t("sourceUrl")}
              </label>
              <input
                className="field field--mono"
                id={`source-url-${source.id}`}
                name={`source-url-${source.id}`}
                onChange={(event) => {
                  updateSource(source.id, (current) => ({
                    ...current,
                    url: event.target.value,
                  }));
                  setSourceUrlError(false);
                }}
                placeholder="https://"
                type="url"
                value={source.url}
              />
            </div>
            {isHttpUrl(source.url) ? (
              <a
                className="source-row__url"
                href={source.url}
                rel="noreferrer"
                target="_blank"
              >
                {t("sourceOpen")}
              </a>
            ) : null}
            <div className="field-row source-row__field">
              <label
                className="field-row__label"
                htmlFor={`source-kind-${source.id}`}
              >
                {t("sourceKind")}
              </label>
              <select
                className="field"
                id={`source-kind-${source.id}`}
                name={`source-kind-${source.id}`}
                onChange={(event) =>
                  updateSource(source.id, (current) => ({
                    ...current,
                    kind: event.target.value as CandidateSource["kind"],
                  }))
                }
                value={source.kind}
              >
                <option value="retail">{t("sourceKind_retail")}</option>
                <option value="manufacturer">
                  {t("sourceKind_manufacturer")}
                </option>
              </select>
            </div>
            <div className="field-row source-row__field">
              <label
                className="field-row__label"
                htmlFor={`source-price-${source.id}`}
              >
                {t("fieldPrice")}
              </label>
              <input
                className="field field--mono"
                id={`source-price-${source.id}`}
                min="0"
                name={`source-price-${source.id}`}
                onChange={(event) => {
                  const raw = event.target.value;
                  updateSource(source.id, (current) => ({
                    ...current,
                    price:
                      raw === ""
                        ? null
                        : {
                            amount: Number(raw),
                            currency: current.price?.currency ?? "JPY",
                          },
                  }));
                  setSourcePriceError(false);
                }}
                placeholder={t("sourceNoPrice")}
                step="any"
                type="number"
                value={source.price?.amount ?? ""}
              />
              <input
                aria-label={t("fieldCurrency")}
                className="field field--currency field--mono"
                disabled={source.price === null}
                name={`source-currency-${source.id}`}
                onChange={(event) => {
                  updateSource(source.id, (current) =>
                    current.price === null
                      ? current
                      : {
                          ...current,
                          price: {
                            ...current.price,
                            currency: event.target.value,
                          },
                        },
                  );
                  setSourcePriceError(false);
                }}
                placeholder="JPY"
                value={source.price?.currency ?? ""}
              />
            </div>
            <label className="source-row__primary">
              <input
                checked={source.primary}
                name="source-primary"
                onChange={() =>
                  onChange({
                    ...draft,
                    sources: draft.sources.map((current) => ({
                      ...current,
                      primary: current.id === source.id,
                    })),
                  })
                }
                type="radio"
              />
              {t("sourcePrimary")}
            </label>
            <div className="source-row__captured">
              {t("sourceCapturedAt", source.capturedAt)}
            </div>
          </div>
        ))
      )}
      {sourceUrlError ? (
        <div className="error-text" role="alert">
          {t("sourceUrlRequired")}
        </div>
      ) : null}
      {sourcePriceError ? (
        <div className="error-text" role="alert">
          {t("sourcePriceInvalid")}
        </div>
      ) : null}
      <div className="source-actions">
        <button
          className="button"
          data-source-add
          onClick={addSource}
          type="button"
        >
          {t("sourceAdd")}
        </button>
      </div>

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
