import type { FormEvent } from "react";
import { useReducer, useState, useSyncExternalStore } from "react";

import {
  type CandidatePartId,
  MOTHERBOARD_FORM_FACTORS,
  PART_CATEGORIES,
  type PartCategory,
  POWER_SUPPLY_FORM_FACTORS,
  type UtcTimestamp,
} from "../../domain/public.js";
import { withCategory } from "./category-draft.js";
import type { CandidateDraft, CandidateSummary } from "./contracts.js";
import type { ManagementDisplayError, ManagementState } from "./state.js";

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
const errorMessages: Readonly<Record<ManagementDisplayError["code"], string>> =
  {
    "unsupported-data":
      "保存データが破損しているか、対応していない形式です。既存データは変更していません。",
    quota:
      "保存容量が不足しています。不要な候補を削除してからもう一度お試しください。",
    storage:
      "保存領域を利用できません。拡張機能を開き直してからもう一度お試しください。",
    maintenance: "保守操作の実行中です。完了後にもう一度お試しください。",
    conflict:
      "他の変更と競合しました。最新の内容を読み込んでからもう一度お試しください。",
    "not-found": "対象が見つかりませんでした。一覧を読み込み直してください。",
    validation: "入力内容を確認してください。",
    "snapshot-restore-failed": "前回の画面状態を復元できませんでした。",
  };

const errorMessage = (code: ManagementDisplayError["code"]) =>
  errorMessages[code];

function CandidateListItem({
  candidate,
  disabled,
  onDelete,
  onEdit,
}: {
  readonly candidate: CandidateSummary;
  readonly disabled: boolean;
  readonly onDelete: (candidate: CandidateSummary) => void;
  readonly onEdit: (candidate: CandidateSummary) => void;
}) {
  const name = displayValue(candidate.name);
  return (
    <li className="candidate-management__candidate">
      <h3>{name}</h3>
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
        aria-label={`${name}を編集`}
        data-edit-candidate-id={candidate.id}
        disabled={disabled}
        onClick={() => onEdit(candidate)}
        type="button"
      >
        編集
      </button>
      <button
        aria-label={`${name}を削除`}
        data-delete-candidate-id={candidate.id}
        disabled={disabled}
        onClick={() => onDelete(candidate)}
        type="button"
      >
        削除
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

type EditableAttribute = {
  readonly key: string;
  readonly label: string;
  readonly list: boolean;
  readonly options?: readonly string[];
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
        {
          key: "formFactor",
          label: "フォームファクター",
          list: false,
          options: MOTHERBOARD_FORM_FACTORS,
        },
      ];
    case "memory":
      return [{ key: "memoryStandard", label: "メモリ規格", list: false }];
    case "power-supply":
      return [
        {
          key: "formFactor",
          label: "フォームファクター",
          list: false,
          options: POWER_SUPPLY_FORM_FACTORS,
        },
      ];
    case "case":
      return [
        {
          key: "supportedMotherboardFormFactors",
          label: "対応マザーボード規格",
          list: true,
          options: MOTHERBOARD_FORM_FACTORS,
        },
        {
          key: "supportedPowerSupplyFormFactors",
          label: "対応電源規格",
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
  const isCustom = value !== "" && !field.options.includes(value);
  const [customMode, setCustomMode] = useState(isCustom);
  const key = `normalizedAttributes.${field.key}`;
  return (
    <div>
      <label>
        {field.label}
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
          <option value="">未選択</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
          <option value={CUSTOM_OPTION}>その他（自由入力）</option>
        </select>
      </label>
      {customMode ? (
        <input
          aria-label={`${field.label}（自由入力）`}
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
      <legend>{field.label}</legend>
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
        その他（カンマ区切りで自由入力）
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

const fieldErrorMessages: Readonly<Record<string, string>> = {
  required: "必須項目です",
  "invalid-url": "http またはhttps のURLを入力してください",
  "invalid-utc-timestamp": "UTCの日時形式で入力してください",
  "invalid-string": "文字列として入力してください",
  "invalid-array": "カンマ区切りの文字列で入力してください",
  "category-mismatch": "選択したカテゴリでは受け付けられない値です",
  "unexpected-field": "選択したカテゴリでは受け付けられない項目です",
  "missing-field": "必須項目です",
  "forbidden-payload": "保存できない内容が含まれています",
};

const fieldErrorMessage = (code: string | undefined): string | null =>
  code === undefined
    ? null
    : (fieldErrorMessages[code] ?? "入力内容を確認してください");

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
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const [nameError, setNameError] = useState<string | null>(null);
  /** Raw text keeps unparsable input visible without storing it in the draft. */
  const [priceText, setPriceText] = useState<string | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const editor = state.value.editor;
  const fieldErrors = state.value.fieldErrors;
  const errorFor = (key: string) => fieldErrorMessage(fieldErrors[key]);
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
      aria-label="候補編集"
      data-region="candidate-form"
      onSubmit={async (event) => {
        event.preventDefault();
        const name =
          draft.product.name.confirmed ?? draft.product.name.original ?? "";
        if (name.trim().length === 0) {
          setNameError("商品名を入力してください");
          return;
        }
        if (priceError !== null) return;
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
        メーカー
        <input
          name="candidate-manufacturer"
          onChange={(event) =>
            setProductText("manufacturer", event.target.value)
          }
          placeholder="未入力"
          value={editableValue(draft.product.manufacturer)}
        />
      </label>
      <label>
        型番
        <input
          name="candidate-model-number"
          onChange={(event) =>
            setProductText("modelNumber", event.target.value)
          }
          placeholder="未入力"
          value={editableValue(draft.product.modelNumber)}
        />
      </label>
      <label>
        価格
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
              setPriceError("数値で入力してください");
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
          placeholder="未入力"
          value={priceText ?? draft.product.price?.confirmed?.amount ?? ""}
        />
      </label>
      <FieldError id="candidate-price-error" message={priceError} />
      <label>
        カテゴリ
        <select
          name="candidate-category"
          onChange={(event) =>
            update(withCategory(draft, event.target.value as PartCategory))
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
              {field.label}
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
      <label>
        取得元URL
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
        取得日時
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
        取得元表記
        <textarea
          name="candidate-source-snapshot"
          readOnly
          value={JSON.stringify(draft.sourceSnapshot ?? {}, null, 2)}
        />
      </label>
      {state.value.displayError === null ? null : (
        <p role="alert">{errorMessage(state.value.displayError.code)}</p>
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
      : { kind: "candidate" as const, name: displayValue(candidate.name) };
  })();

  return (
    <section aria-label="候補管理" className="candidate-management">
      <nav aria-label="プロジェクト" data-region="projects">
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
        data-region="project-form"
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
          <p role="alert">{errorMessage(value.displayError.code)}</p>
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
        候補を作成
      </button>
      <ul aria-label="候補一覧" data-region="candidate-list">
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
            <p role="alert">{errorMessage(value.displayError.code)}</p>
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
      {/* Remounting per target drops raw input state left over from another candidate. */}
      <CandidateEditorForm key={editorKey(value.editor)} state={state} />
    </section>
  );
}
