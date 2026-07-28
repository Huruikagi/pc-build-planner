import type { FormEvent } from "react";
import { useReducer, useState, useSyncExternalStore } from "react";

import {
  type CandidatePartId,
  type CandidateSource,
  type CandidateSourceId,
  createUuid,
  MOTHERBOARD_FORM_FACTORS,
  PART_CATEGORIES,
  type PartCategory,
  POWER_SUPPLY_FORM_FACTORS,
  type UtcTimestamp,
} from "../../domain/public.js";
import type { MessageKey, MessageResolver } from "../../ui-messages/public.js";
import { useMessages } from "../../ui-messages/public.js";
import { withCategory } from "./category-draft.js";
import type { CandidateDraft, CandidateSummary } from "./contracts.js";
import type { ManagementDisplayError, ManagementState } from "./state.js";

const categoryMessageKeys = {
  cpu: "category.cpu",
  "cpu-cooler": "category.cpu-cooler",
  motherboard: "category.motherboard",
  memory: "category.memory",
  gpu: "category.gpu",
  storage: "category.storage",
  "power-supply": "category.power-supply",
  case: "category.case",
  "case-fan": "category.case-fan",
  "expansion-card": "category.expansion-card",
  other: "category.other",
  uncategorized: "category.uncategorized",
} as const satisfies Record<PartCategory, MessageKey>;

function displayValue(
  value:
    | { readonly original: string | null; readonly confirmed?: string }
    | undefined,
  messages: MessageResolver,
): string {
  return value?.confirmed ?? value?.original ?? messages("common.notEntered");
}

/**
 * The editing counterpart of `displayValue`: a missing value stays empty so the
 * list placeholder never becomes a value the user would have to delete first.
 */
function editableValue(
  value:
    | { readonly original: string | null; readonly confirmed?: string }
    | undefined,
): string {
  return value?.confirmed ?? value?.original ?? "";
}

/** Each failure stays distinguishable so the user can pick a recovery action. */
const errorMessageKeys = {
  "unsupported-data": "candidate.errors.unsupportedData",
  quota: "persistenceError.quota",
  storage: "candidate.errors.storage",
  maintenance: "persistenceError.maintenance",
  conflict: "persistenceError.conflict",
  "not-found": "candidate.errors.notFound",
  validation: "persistenceError.validation",
  "snapshot-restore-failed": "persistenceError.snapshotRestoreFailed",
} as const satisfies Record<ManagementDisplayError["code"], MessageKey>;

const errorMessage = (
  code: ManagementDisplayError["code"],
  messages: MessageResolver,
) => messages(errorMessageKeys[code]);

function CandidateListItem({
  candidate,
  disabled,
  onDelete,
  onEdit,
  onOpenSource,
}: {
  readonly candidate: CandidateSummary;
  readonly disabled: boolean;
  readonly onDelete: (candidate: CandidateSummary) => void;
  readonly onEdit: (candidate: CandidateSummary) => void;
  readonly onOpenSource: (url: string) => void;
}) {
  const messages = useMessages();
  const name = displayValue(candidate.name, messages);
  return (
    <li className="candidate-management__candidate">
      <h3>{name}</h3>
      <dl>
        <div>
          <dt>{messages("candidate.categoryFieldLabel")}</dt>
          <dd>{messages(categoryMessageKeys[candidate.category])}</dd>
        </div>
        <div>
          <dt>{messages("candidate.manufacturerFieldLabel")}</dt>
          <dd>{displayValue(candidate.manufacturer, messages)}</dd>
        </div>
        <div>
          <dt>{messages("candidate.modelNumberFieldLabel")}</dt>
          <dd>{displayValue(candidate.modelNumber, messages)}</dd>
        </div>
        <div>
          <dt>{messages("candidate.priceFieldLabel")}</dt>
          <dd>
            {candidate.price === undefined
              ? messages("common.notEntered")
              : messages("candidate.priceEntered")}
          </dd>
        </div>
        <div>
          <dt>{messages("candidate.sources.primary")}</dt>
          <dd>
            {candidate.primarySource === undefined
              ? messages("common.notEntered")
              : messages(
                  candidate.primarySource.kind === "manufacturer"
                    ? "candidate.sources.kind.manufacturer"
                    : "candidate.sources.kind.retail",
                )}
          </dd>
        </div>
      </dl>
      {candidate.primarySource?.pageUrl === undefined ? null : (
        <button
          data-open-primary-source-id={candidate.primarySource.id}
          disabled={disabled}
          onClick={() => onOpenSource(candidate.primarySource?.pageUrl ?? "")}
          type="button"
        >
          {messages("candidate.sources.open")}
        </button>
      )}
      {candidate.hasMissingDetails ? (
        <p>{messages("candidate.missingDetailsNotice")}</p>
      ) : null}
      <button
        aria-label={messages("candidate.editCandidateAction", { name })}
        data-edit-candidate-id={candidate.id}
        disabled={disabled}
        onClick={() => onEdit(candidate)}
        type="button"
      >
        {messages("candidate.editAction")}
      </button>
      <button
        aria-label={messages("candidate.deleteCandidateAction", { name })}
        data-delete-candidate-id={candidate.id}
        disabled={disabled}
        onClick={() => onDelete(candidate)}
        type="button"
      >
        {messages("common.delete")}
      </button>
    </li>
  );
}

/**
 * Clears a confirmed price without inventing one. Any extracted original is
 * kept, because a missing confirmed value is a normal state, not a zero.
 */
const withoutConfirmedPrice = (draft: CandidateDraft): CandidateDraft => {
  const { price, ...withoutPrice } = draft.product;
  const original = price?.original ?? null;
  return {
    ...draft,
    product:
      original === null
        ? withoutPrice
        : { ...withoutPrice, price: { original } },
  } as CandidateDraft;
};

type AttributeLabelKey =
  | "candidate.attributeLabels.socket"
  | "candidate.attributeLabels.supportedSockets"
  | "candidate.attributeLabels.memoryStandard"
  | "candidate.attributeLabels.formFactor"
  | "candidate.attributeLabels.supportedMotherboardFormFactors"
  | "candidate.attributeLabels.supportedPowerSupplyFormFactors";

type EditableAttribute = {
  readonly key: string;
  readonly labelKey: AttributeLabelKey;
  readonly list: boolean;
  readonly options?: readonly string[];
};

const editableAttributes = (
  category: PartCategory,
): readonly EditableAttribute[] => {
  switch (category) {
    case "cpu":
      return [
        {
          key: "socket",
          labelKey: "candidate.attributeLabels.socket",
          list: false,
        },
      ];
    case "cpu-cooler":
      return [
        {
          key: "supportedSockets",
          labelKey: "candidate.attributeLabels.supportedSockets",
          list: true,
        },
      ];
    case "motherboard":
      return [
        {
          key: "socket",
          labelKey: "candidate.attributeLabels.socket",
          list: false,
        },
        {
          key: "memoryStandard",
          labelKey: "candidate.attributeLabels.memoryStandard",
          list: false,
        },
        {
          key: "formFactor",
          labelKey: "candidate.attributeLabels.formFactor",
          list: false,
          options: MOTHERBOARD_FORM_FACTORS,
        },
      ];
    case "memory":
      return [
        {
          key: "memoryStandard",
          labelKey: "candidate.attributeLabels.memoryStandard",
          list: false,
        },
      ];
    case "power-supply":
      return [
        {
          key: "formFactor",
          labelKey: "candidate.attributeLabels.formFactor",
          list: false,
          options: POWER_SUPPLY_FORM_FACTORS,
        },
      ];
    case "case":
      return [
        {
          key: "supportedMotherboardFormFactors",
          labelKey: "candidate.attributeLabels.supportedMotherboardFormFactors",
          list: true,
          options: MOTHERBOARD_FORM_FACTORS,
        },
        {
          key: "supportedPowerSupplyFormFactors",
          labelKey: "candidate.attributeLabels.supportedPowerSupplyFormFactors",
          list: true,
          options: POWER_SUPPLY_FORM_FACTORS,
        },
      ];
    default:
      return [];
  }
};

/** Sentinel select value that switches a form-factor field into free-text entry. */
const CUSTOM_OPTION = "__custom__";

/**
 * A select of known, stable form-factor values with a free-text escape hatch,
 * since scraped or future form factors may fall outside the fixed list.
 */
function SingleFormFactorField({
  error,
  field,
  onChange,
  value,
}: {
  readonly error: string | null;
  readonly field: EditableAttribute & { readonly options: readonly string[] };
  readonly onChange: (value: string) => void;
  readonly value: string;
}) {
  const messages = useMessages();
  const isCustom = value !== "" && !field.options.includes(value);
  const [customMode, setCustomMode] = useState(isCustom);
  const key = `normalizedAttributes.${field.key}`;
  const fieldLabel = messages(field.labelKey);
  return (
    <div>
      <label>
        {fieldLabel}
        <select
          aria-describedby={error === null ? undefined : `${key}-error`}
          aria-invalid={error === null ? undefined : true}
          name={`attribute-${field.key}`}
          onChange={(event) => {
            if (event.target.value === CUSTOM_OPTION) {
              setCustomMode(true);
              return;
            }
            setCustomMode(false);
            onChange(event.target.value);
          }}
          value={customMode ? CUSTOM_OPTION : value}
        >
          <option value="">{messages("common.notSelected")}</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
          <option value={CUSTOM_OPTION}>
            {messages("candidate.customOptionLabel")}
          </option>
        </select>
      </label>
      {customMode ? (
        <input
          aria-label={messages("candidate.customFieldAriaLabel", {
            field: fieldLabel,
          })}
          name={`attribute-${field.key}-custom`}
          onChange={(event) => onChange(event.target.value)}
          value={value}
        />
      ) : null}
      <FieldError id={`${key}-error`} message={error} />
    </div>
  );
}

/**
 * Checkbox group over known form-factor values plus a comma-separated
 * free-text field for values outside the fixed list.
 */
function MultiFormFactorField({
  error,
  field,
  onChange,
  values,
}: {
  readonly error: string | null;
  readonly field: EditableAttribute & { readonly options: readonly string[] };
  readonly onChange: (values: readonly string[]) => void;
  readonly values: readonly string[];
}) {
  const messages = useMessages();
  const extra = values.filter((value) => !field.options.includes(value));
  const [extraText, setExtraText] = useState(extra.join(", "));
  const key = `normalizedAttributes.${field.key}`;
  const toggle = (option: string, checked: boolean) => {
    const known = values.filter((value) => field.options.includes(value));
    const nextKnown = checked
      ? [...known, option]
      : known.filter((value) => value !== option);
    onChange([...nextKnown, ...extra]);
  };
  return (
    <fieldset aria-describedby={error === null ? undefined : `${key}-error`}>
      <legend>{messages(field.labelKey)}</legend>
      {field.options.map((option) => (
        <label key={option}>
          <input
            checked={values.includes(option)}
            onChange={(event) => toggle(option, event.target.checked)}
            type="checkbox"
          />
          {option}
        </label>
      ))}
      <label>
        {messages("candidate.customListLabel")}
        <input
          name={`attribute-${field.key}-custom`}
          onChange={(event) => {
            setExtraText(event.target.value);
            const known = values.filter((value) =>
              field.options.includes(value),
            );
            const parsed = event.target.value
              .split(",")
              .map((item) => item.trim())
              .filter((item) => item.length > 0);
            onChange([...known, ...parsed]);
          }}
          value={extraText}
        />
      </label>
      <FieldError id={`${key}-error`} message={error} />
    </fieldset>
  );
}

type FieldErrorMessageKey =
  | "candidate.fieldErrors.required"
  | "candidate.fieldErrors.invalid-url"
  | "candidate.fieldErrors.invalid-utc-timestamp"
  | "candidate.fieldErrors.invalid-string"
  | "candidate.fieldErrors.invalid-array"
  | "candidate.fieldErrors.category-mismatch"
  | "candidate.fieldErrors.unexpected-field"
  | "candidate.fieldErrors.missing-field"
  | "candidate.fieldErrors.forbidden-payload";

const fieldErrorMessageKeys: Readonly<
  Partial<Record<string, FieldErrorMessageKey>>
> = {
  required: "candidate.fieldErrors.required",
  "invalid-url": "candidate.fieldErrors.invalid-url",
  "invalid-utc-timestamp": "candidate.fieldErrors.invalid-utc-timestamp",
  "invalid-string": "candidate.fieldErrors.invalid-string",
  "invalid-array": "candidate.fieldErrors.invalid-array",
  "category-mismatch": "candidate.fieldErrors.category-mismatch",
  "unexpected-field": "candidate.fieldErrors.unexpected-field",
  "missing-field": "candidate.fieldErrors.missing-field",
  "forbidden-payload": "candidate.fieldErrors.forbidden-payload",
};

const fieldErrorMessage = (
  code: string | undefined,
  messages: MessageResolver,
): string | null =>
  code === undefined
    ? null
    : messages(fieldErrorMessageKeys[code] ?? "candidate.fieldErrors.default");

/** Binds a draft-relative field key to its input for assistive technology. */
function FieldError({
  id,
  message,
}: {
  readonly id: string;
  readonly message: string | null;
}) {
  return message === null ? null : (
    <p id={id} role="alert">
      {message}
    </p>
  );
}

const editorKey = (editor: ManagementState["value"]["editor"]): string => {
  if (editor === null) return "closed";
  return editor.mode === "create"
    ? `create:${editor.projectId}`
    : `edit:${editor.candidateId}`;
};

function CandidateEditorForm({ state }: { readonly state: ManagementState }) {
  const messages = useMessages();
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const [nameError, setNameError] = useState<string | null>(null);
  /** Raw text keeps unparsable input visible without storing it in the draft. */
  const [priceText, setPriceText] = useState<string | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [sourcePriceText, setSourcePriceText] = useState<
    Readonly<Record<string, string>>
  >({});
  const [sourcePriceErrors, setSourcePriceErrors] = useState<
    Readonly<Record<string, string>>
  >({});
  const [sourceUrlErrors, setSourceUrlErrors] = useState<
    Readonly<Record<string, string>>
  >({});
  const [replacementIds, setReplacementIds] = useState<
    Readonly<Record<string, string>>
  >({});
  const editor = state.value.editor;
  const fieldErrors = state.value.fieldErrors;
  const errorFor = (key: string) =>
    fieldErrorMessage(fieldErrors[key], messages);
  if (editor === null) return null;
  const { draft } = editor;
  const update = (next: CandidateDraft) => {
    state.updateEditorDraft(next);
    rerender();
  };
  const updateSource = (source: CandidateSource) => {
    state.updateEditorSource(source);
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
  const setAttributeList = (
    field: EditableAttribute,
    values: readonly string[],
  ) =>
    update({
      ...draft,
      normalizedAttributes: {
        ...attributes,
        [field.key]: { original: null, confirmed: values },
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
      aria-label={messages("candidate.editorFormTitle")}
      data-region="candidate-form"
      onSubmit={async (event) => {
        event.preventDefault();
        const name =
          draft.product.name.confirmed ?? draft.product.name.original ?? "";
        if (name.trim().length === 0) {
          setNameError(messages("candidate.nameRequiredError"));
          return;
        }
        if (
          priceError !== null ||
          Object.keys(sourcePriceErrors).length > 0 ||
          Object.keys(sourceUrlErrors).length > 0
        )
          return;
        await state.saveEditor();
        rerender();
      }}
    >
      <h2>
        {messages(
          editor.mode === "create"
            ? "candidate.createCandidateHeading"
            : "candidate.editCandidateHeading",
        )}
      </h2>
      <label>
        {messages("candidate.nameFieldLabel")}
        <input
          disabled={state.value.isSaving || state.value.mutationsDisabled}
          aria-describedby={
            nameError === null && errorFor("product.name") === null
              ? undefined
              : "candidate-name-error"
          }
          aria-invalid={
            nameError === null && errorFor("product.name") === null
              ? undefined
              : true
          }
          name="candidate-name"
          onChange={(event) => setProductText("name", event.target.value)}
          value={editableValue(draft.product.name)}
        />
      </label>
      <FieldError
        id="candidate-name-error"
        message={nameError ?? errorFor("product.name")}
      />
      <label>
        {messages("candidate.manufacturerFieldLabel")}
        <input
          name="candidate-manufacturer"
          onChange={(event) =>
            setProductText("manufacturer", event.target.value)
          }
          placeholder={messages("common.notEntered")}
          value={editableValue(draft.product.manufacturer)}
        />
      </label>
      <label>
        {messages("candidate.modelNumberFieldLabel")}
        <input
          name="candidate-model-number"
          onChange={(event) =>
            setProductText("modelNumber", event.target.value)
          }
          placeholder={messages("common.notEntered")}
          value={editableValue(draft.product.modelNumber)}
        />
      </label>
      <label>
        {messages("candidate.priceFieldLabel")}
        <input
          aria-describedby={
            priceError === null ? undefined : "candidate-price-error"
          }
          aria-invalid={priceError === null ? undefined : true}
          inputMode="decimal"
          name="candidate-price-amount"
          onChange={(event) => {
            const raw = event.target.value;
            setPriceText(raw);
            if (raw.trim().length === 0) {
              setPriceError(null);
              update(withoutConfirmedPrice(draft));
              return;
            }
            const amount = Number(raw);
            if (!Number.isFinite(amount)) {
              // Unparsable text is reported, never rounded into a stored price.
              setPriceError(messages("candidate.priceNotNumberError"));
              update(withoutConfirmedPrice(draft));
              return;
            }
            setPriceError(null);
            const previous = draft.product.price;
            update({
              ...draft,
              product: {
                ...draft.product,
                price: {
                  original: previous?.original ?? null,
                  confirmed: {
                    amount,
                    // An empty currency means "unknown", never a guessed locale.
                    currency: previous?.confirmed?.currency ?? "",
                  },
                },
              },
            } as CandidateDraft);
          }}
          placeholder={messages("common.notEntered")}
          value={priceText ?? draft.product.price?.confirmed?.amount ?? ""}
        />
      </label>
      <FieldError id="candidate-price-error" message={priceError} />
      <label>
        {messages("candidate.categoryFieldLabel")}
        <select
          name="candidate-category"
          onChange={(event) =>
            update(withCategory(draft, event.target.value as PartCategory))
          }
          value={draft.category}
        >
          {PART_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {messages(categoryMessageKeys[category])}
            </option>
          ))}
        </select>
      </label>
      {editableAttributes(draft.category).map((field) => {
        const value = attributeValues[field.key];
        const confirmed = value?.confirmed;
        const key = `normalizedAttributes.${field.key}`;
        const message = errorFor(key);
        if (field.options !== undefined && field.list) {
          const values = Array.isArray(confirmed) ? confirmed : [];
          return (
            <MultiFormFactorField
              error={message}
              field={
                field as EditableAttribute & { options: readonly string[] }
              }
              key={field.key}
              onChange={(next) => setAttributeList(field, next)}
              values={values}
            />
          );
        }
        if (field.options !== undefined && !field.list) {
          const stringValue: string = Array.isArray(confirmed)
            ? ""
            : ((confirmed as string | undefined) ?? value?.original ?? "");
          return (
            <SingleFormFactorField
              error={message}
              field={
                field as EditableAttribute & { options: readonly string[] }
              }
              key={field.key}
              onChange={(next) => setAttribute(field, next)}
              value={stringValue}
            />
          );
        }
        return (
          <div key={field.key}>
            <label>
              {messages(field.labelKey)}
              <input
                aria-describedby={message === null ? undefined : `${key}-error`}
                aria-invalid={message === null ? undefined : true}
                name={`attribute-${field.key}`}
                onChange={(event) => setAttribute(field, event.target.value)}
                value={
                  Array.isArray(confirmed)
                    ? confirmed.join(", ")
                    : (confirmed ?? value?.original ?? "")
                }
              />
            </label>
            <FieldError id={`${key}-error`} message={message} />
          </div>
        );
      })}
      <fieldset data-region="candidate-sources">
        <legend>{messages("candidate.sources.label")}</legend>
        {(draft.sources ?? []).map((source, index) => {
          const priceText =
            sourcePriceText[source.id] ?? source.price?.confirmed?.amount ?? "";
          const priceError = sourcePriceErrors[source.id];
          const isPrimary = source.id === draft.primarySourceId;
          return (
            <section data-source-id={source.id} key={source.id}>
              <label>
                {messages("candidate.sourceUrlLabel")}
                <input
                  aria-describedby={
                    sourceUrlErrors[source.id] === undefined
                      ? undefined
                      : `source-url-${source.id}-error`
                  }
                  aria-invalid={
                    sourceUrlErrors[source.id] === undefined ? undefined : true
                  }
                  name={`source-${index}-url`}
                  onChange={(event) => {
                    const pageUrl = event.target.value;
                    let valid = false;
                    try {
                      const parsed = new URL(pageUrl);
                      valid =
                        parsed.protocol === "http:" ||
                        parsed.protocol === "https:";
                    } catch {
                      valid = false;
                    }
                    setSourceUrlErrors((current) => {
                      if (!valid)
                        return {
                          ...current,
                          [source.id]: messages(
                            "candidate.sources.errors.invalidUrl",
                          ),
                        };
                      const { [source.id]: _error, ...rest } = current;
                      return rest;
                    });
                    updateSource({ ...source, pageUrl });
                  }}
                  value={source.pageUrl ?? ""}
                />
              </label>
              <FieldError
                id={`source-url-${source.id}-error`}
                message={sourceUrlErrors[source.id] ?? null}
              />
              <label>
                {messages("candidate.sources.label")}
                <input
                  name={`source-${index}-site-name`}
                  onChange={(event) =>
                    updateSource({ ...source, siteName: event.target.value })
                  }
                  value={source.siteName ?? ""}
                />
              </label>
              <label>
                {messages("candidate.capturedAtLabel")}
                <input
                  name={`source-${index}-captured-at`}
                  onChange={(event) =>
                    updateSource({
                      ...source,
                      capturedAt: event.target.value as UtcTimestamp,
                    })
                  }
                  value={source.capturedAt ?? ""}
                />
              </label>
              <label>
                {messages("candidate.priceFieldLabel")}
                <input
                  aria-describedby={
                    priceError === undefined
                      ? undefined
                      : `source-price-${source.id}-error`
                  }
                  aria-invalid={priceError === undefined ? undefined : true}
                  inputMode="decimal"
                  name={`source-${index}-price`}
                  onChange={(event) => {
                    const raw = event.target.value;
                    setSourcePriceText((current) => ({
                      ...current,
                      [source.id]: raw,
                    }));
                    if (raw.trim() === "") {
                      const { price: _price, ...withoutPrice } = source;
                      setSourcePriceErrors((current) => {
                        const { [source.id]: _error, ...rest } = current;
                        return rest;
                      });
                      updateSource(withoutPrice);
                      return;
                    }
                    const amount = Number(raw);
                    if (!Number.isFinite(amount)) {
                      setSourcePriceErrors((current) => ({
                        ...current,
                        [source.id]: messages("candidate.priceNotNumberError"),
                      }));
                      return;
                    }
                    setSourcePriceErrors((current) => {
                      const { [source.id]: _error, ...rest } = current;
                      return rest;
                    });
                    updateSource({
                      ...source,
                      price: {
                        original: source.price?.original ?? null,
                        confirmed: {
                          amount,
                          currency: source.price?.confirmed?.currency ?? "",
                        },
                      },
                    });
                  }}
                  value={priceText}
                />
              </label>
              <FieldError
                id={`source-price-${source.id}-error`}
                message={priceError ?? null}
              />
              <label>
                {messages("candidate.sources.kind.retail")}
                <select
                  name={`source-${index}-kind`}
                  onChange={(event) =>
                    updateSource({
                      ...source,
                      kind: event.target.value as NonNullable<
                        CandidateSource["kind"]
                      >,
                    })
                  }
                  value={source.kind ?? "retail"}
                >
                  <option value="retail">
                    {messages("candidate.sources.kind.retail")}
                  </option>
                  <option value="manufacturer">
                    {messages("candidate.sources.kind.manufacturer")}
                  </option>
                </select>
              </label>
              <label>
                <input
                  checked={isPrimary}
                  name="candidate-primary-source"
                  onChange={() => {
                    state.setEditorPrimarySource(source.id);
                    rerender();
                  }}
                  type="radio"
                />
                {messages("candidate.sources.primary")}
              </label>
              {isPrimary && (draft.sources?.length ?? 0) > 1 ? (
                <select
                  aria-label={messages("candidate.sources.primary")}
                  onChange={(event) =>
                    setReplacementIds((current) => ({
                      ...current,
                      [source.id]: event.target.value,
                    }))
                  }
                  value={replacementIds[source.id] ?? ""}
                >
                  <option value="">{messages("common.notEntered")}</option>
                  {(draft.sources ?? [])
                    .filter((item) => item.id !== source.id)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.siteName ?? item.pageUrl ?? item.id}
                      </option>
                    ))}
                </select>
              ) : null}
              {source.pageUrl === undefined ? null : (
                <button
                  onClick={() => void state.openSource(source.pageUrl ?? "")}
                  type="button"
                >
                  {messages("candidate.sources.open")}
                </button>
              )}
              <button
                onClick={() => {
                  state.removeEditorSource(
                    source.id,
                    replacementIds[source.id] as CandidateSourceId | undefined,
                  );
                  rerender();
                }}
                type="button"
              >
                {messages("candidate.sources.remove")}
              </button>
            </section>
          );
        })}
        <button
          onClick={() => {
            state.addEditorSource({
              id: createUuid() as CandidateSourceId,
              pageUrl: "",
              kind: "retail",
            });
            rerender();
          }}
          type="button"
        >
          {messages("candidate.sources.add")}
        </button>
        {state.value.sourceOperationError?.kind === "replacement-required" ? (
          <p role="alert">
            {messages("candidate.sources.errors.replacementRequired")}
          </p>
        ) : null}
        {state.value.sourceOpenError === null ? null : (
          <p role="alert">
            {messages(
              state.value.sourceOpenError.kind === "runtime-unavailable"
                ? "candidate.sources.errors.runtimeUnavailable"
                : "candidate.sources.errors.openFailed",
            )}
          </p>
        )}
      </fieldset>
      <label>
        {messages("candidate.sourceUrlLabel")}
        <input
          aria-describedby={
            errorFor("sourceInfo.pageUrl") === null
              ? undefined
              : "candidate-source-url-error"
          }
          aria-invalid={
            errorFor("sourceInfo.pageUrl") === null ? undefined : true
          }
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
      <FieldError
        id="candidate-source-url-error"
        message={errorFor("sourceInfo.pageUrl")}
      />
      <label>
        {messages("candidate.capturedAtLabel")}
        <input
          aria-describedby={
            errorFor("sourceInfo.capturedAt") === null
              ? undefined
              : "candidate-captured-at-error"
          }
          aria-invalid={
            errorFor("sourceInfo.capturedAt") === null ? undefined : true
          }
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
      <FieldError
        id="candidate-captured-at-error"
        message={errorFor("sourceInfo.capturedAt")}
      />
      <label>
        {messages("candidate.sourceSnapshotLabel")}
        <textarea
          name="candidate-source-snapshot"
          readOnly
          value={JSON.stringify(draft.sourceSnapshot ?? {}, null, 2)}
        />
      </label>
      {state.value.displayError === null ? null : (
        <p role="alert">
          {errorMessage(state.value.displayError.code, messages)}
        </p>
      )}
      <button
        disabled={state.value.isSaving || state.value.mutationsDisabled}
        type="submit"
      >
        {messages("common.save")}
      </button>
      <button
        disabled={state.value.isSaving}
        onClick={() => {
          state.cancelEditor();
          rerender();
        }}
        type="button"
      >
        {messages("common.cancel")}
      </button>
    </form>
  );
}

/** Renders feature-owned state without moving domain state into React hooks. */
export function ManagementView({ state }: { readonly state: ManagementState }) {
  const messages = useMessages();
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  useSyncExternalStore(
    (listener) => state.subscribe(listener),
    () => state.value,
    () => state.value,
  );
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
      setProjectNameError(messages("candidate.projectNameRequiredError"));
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
  const startEdit = async (candidateId: CandidatePartId) => {
    await state.startEdit(candidateId);
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
      : {
          kind: "candidate" as const,
          name: displayValue(candidate.name, messages),
        };
  })();

  return (
    <section
      aria-label={messages("candidate.title")}
      className="candidate-management"
    >
      <nav
        aria-label={messages("candidate.projectsNav")}
        data-region="projects"
      >
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
              {messages("candidate.renameProject")}
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
              {messages("common.delete")}
            </button>
          </span>
        ))}
      </nav>
      <form
        aria-label={messages("candidate.projectFormTitle")}
        data-region="project-form"
        onSubmit={(event) => void saveProject(event)}
      >
        <label>
          {messages(
            editingProjectId === null
              ? "candidate.newProjectNameLabel"
              : "candidate.projectNameLabel",
          )}
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
          <p role="alert">{errorMessage(value.displayError.code, messages)}</p>
        )}
        <button
          disabled={value.isSaving || value.mutationsDisabled}
          type="submit"
        >
          {messages(
            editingProjectId === null
              ? "candidate.createProjectAction"
              : "candidate.saveProjectNameAction",
          )}
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
            {messages("common.cancel")}
          </button>
        )}
      </form>
      <nav aria-label={messages("candidate.categoryNav")}>
        <button
          aria-current={value.selectedCategory === null ? "page" : undefined}
          data-category="all"
          onClick={() => void selectCategory(null)}
          type="button"
        >
          {messages("candidate.allCategories")}
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
            {messages(categoryMessageKeys[category])}
          </button>
        ))}
      </nav>
      <button
        data-create-candidate
        disabled={
          value.selectedProjectId === null ||
          value.isSaving ||
          value.mutationsDisabled
        }
        onClick={() => {
          state.startCreate();
          rerender();
        }}
        type="button"
      >
        {messages("candidate.createCandidateAction")}
      </button>
      <ul
        aria-label={messages("candidate.candidateListLabel")}
        data-region="candidate-list"
      >
        {value.candidates.map((candidate) => (
          <CandidateListItem
            candidate={candidate}
            disabled={value.isSaving || value.mutationsDisabled}
            key={candidate.id}
            onDelete={() => {
              state.requestDeletion({
                kind: "candidate",
                candidateId: candidate.id,
              });
              rerender();
            }}
            onEdit={() => void startEdit(candidate.id)}
            onOpenSource={(url) => void state.openSource(url)}
          />
        ))}
      </ul>
      {deletionTarget === null ? null : (
        <section
          aria-label={messages("candidate.deleteConfirmationTitle")}
          role="dialog"
        >
          <h2>{messages("candidate.deleteConfirmationHeading")}</h2>
          {deletionTarget.kind === "project" ? (
            <p>
              {messages("candidate.deleteProjectMessage", {
                name: deletionTarget.name,
              })}
            </p>
          ) : (
            <p>
              {messages("candidate.deleteCandidateMessage", {
                name: deletionTarget.name,
              })}
            </p>
          )}
          {value.displayError === null ? null : (
            <p role="alert">
              {errorMessage(value.displayError.code, messages)}
            </p>
          )}
          <button
            data-confirm-deletion
            disabled={value.isSaving || value.mutationsDisabled}
            onClick={() => void confirmDeletion()}
            type="button"
          >
            {messages("candidate.confirmDeleteAction")}
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
            {messages("common.dismiss")}
          </button>
        </section>
      )}
      {/* Remounting per target drops raw input state left over from another candidate. */}
      <CandidateEditorForm key={editorKey(value.editor)} state={state} />
    </section>
  );
}
