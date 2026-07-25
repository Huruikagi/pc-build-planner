import { useState, useSyncExternalStore } from "react";
import type { PartCategory, ProjectId } from "../../domain/public.js";
import { inferCategoryHint } from "./category-hint.js";
import {
  CAPTURE_CORE_FIELDS,
  type CaptureCoreField,
  type CaptureError,
  type CaptureField,
  type CaptureNormalizedValue,
  type CaptureSession,
  type ExtractionSource,
} from "./contracts.js";
import type { CaptureState } from "./state.js";

export interface CaptureProjectOption {
  readonly id: ProjectId;
  readonly name: string;
}

export interface CaptureViewProps {
  readonly state: CaptureState;
  readonly projects: readonly CaptureProjectOption[];
  /** Detail-edit navigation (`CandidateEditorNavigation.open`) is wired by a later task. */
  readonly onOpenDetailEdit?: (manualName?: string) => void;
}

const FIELD_LABELS: Readonly<Record<CaptureCoreField, string>> = {
  name: "商品名",
  category: "カテゴリ",
  price: "価格",
  manufacturer: "メーカー",
  modelNumber: "型番",
  url: "URL",
};

/** Labels for the read-only category suggestion; the formal picker lives in detail edit. */
const CATEGORY_HINT_LABELS: Readonly<Record<PartCategory, string>> = {
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

const SOURCE_LABELS: Readonly<Record<ExtractionSource, string>> = {
  "json-ld": "構造化データ",
  meta: "メタ情報",
  heading: "見出し",
  breadcrumb: "パンくず",
  table: "表",
  "definition-list": "定義リスト",
};

const ERROR_MESSAGES: Readonly<Record<CaptureError["kind"], string>> = {
  "permission-lost":
    "ページへのアクセス権限が失効しました。ページを表示し直してから再実行してください。",
  "restricted-page":
    "このページは拡張から読み取れないため取り込みの対象外です。",
  "tab-changed":
    "取り込み中にページが移動または更新されました。表示中のページで再実行してください。",
  "injection-failed":
    "ページの読み取りに失敗しました。もう一度実行してください。",
  "invalid-payload":
    "ページから取得した内容を解釈できませんでした。もう一度実行してください。",
  "no-candidate": "このページからは商品情報を自動取得できませんでした。",
  validation: "入力内容を確認してください。",
  "project-required":
    "保存先のプロジェクトを選択してください。プロジェクトがない場合は先に作成してください。",
  navigation: "詳細編集画面を開けませんでした。",
  maintenance: "保守操作の実行中です。完了後にもう一度お試しください。",
  storage: "保存領域を利用できません。もう一度お試しください。",
  quota:
    "保存容量が不足しています。不要な候補を削除してからもう一度お試しください。",
  "unsupported-data": "保存データが破損しているか、対応していない形式です。",
};

const formatNormalizedValue = (value: CaptureNormalizedValue): string =>
  typeof value === "string" ? value : `${value.amount} ${value.currency}`;

const fieldEntry = (session: CaptureSession, field: CaptureField) =>
  session.fields.find((candidate) => candidate.field === field);

/** The current working value: a user edit, else the normalizer's suggestion, else empty. */
const resolvedFieldText = (
  session: CaptureSession,
  field: CaptureCoreField,
): string => {
  const corrected = session.userCorrections[field];
  if (corrected !== undefined) return corrected;
  const entry = fieldEntry(session, field);
  if (entry === undefined) return "";
  return entry.value.confirmed === undefined
    ? (entry.value.original ?? "")
    : formatNormalizedValue(entry.value.confirmed);
};

const resolvedName = (session: CaptureSession): string =>
  resolvedFieldText(session, "name").trim();

function FieldRow({
  field,
  session,
  onChange,
}: {
  readonly field: CaptureCoreField;
  readonly session: CaptureSession;
  readonly onChange: (field: CaptureField, value: string) => void;
}) {
  const entry = fieldEntry(session, field);
  const missing = session.missingCoreFields.includes(field);
  return (
    <div className="product-capture__field" data-capture-field-row={field}>
      <label>
        {FIELD_LABELS[field]}
        <input
          data-capture-field={field}
          onChange={(event) => onChange(field, event.target.value)}
          value={resolvedFieldText(session, field)}
        />
      </label>
      {entry === undefined ? null : (
        <p className="product-capture__source">
          取得元: {SOURCE_LABELS[entry.source]}（{entry.sourceLabel}）
        </p>
      )}
      {entry?.value.original === null ||
      entry?.value.original === undefined ? null : entry.value.original
          .length === 0 ? null : (
        <p className="product-capture__original">
          元表記: {entry.value.original}
        </p>
      )}
      {missing ? (
        <p className="product-capture__missing" role="status">
          未入力の項目です
        </p>
      ) : null}
    </div>
  );
}

/**
 * Category is read-only here: its value is never persisted from this panel and
 * only seeds the detail editor's default selection (see `category-hint`). An
 * editable field would imply a correction that is silently dropped, so we show
 * the inferred suggestion and its source label instead of an input.
 */
function CategoryRow({ session }: { readonly session: CaptureSession }) {
  const entry = fieldEntry(session, "category");
  const text = resolvedFieldText(session, "category");
  const hint = inferCategoryHint(text);
  const missing = session.missingCoreFields.includes("category");
  return (
    <div className="product-capture__field" data-capture-field-row="category">
      <p className="product-capture__field-label">{FIELD_LABELS.category}</p>
      <p className="product-capture__category-hint" data-capture-category-hint>
        {hint === undefined
          ? "推定できませんでした（詳細編集で選択します）"
          : `推定: ${CATEGORY_HINT_LABELS[hint]}（詳細編集の初期選択になります）`}
      </p>
      {entry === undefined ? null : (
        <p className="product-capture__source">
          取得元: {SOURCE_LABELS[entry.source]}（{entry.sourceLabel}）
        </p>
      )}
      {entry?.value.original === null ||
      entry?.value.original === undefined ? null : entry.value.original
          .length === 0 ? null : (
        <p className="product-capture__original">
          元表記: {entry.value.original}
        </p>
      )}
      {missing ? (
        <p className="product-capture__missing" role="status">
          未入力の項目です
        </p>
      ) : null}
    </div>
  );
}

function RejectedFields({
  rejectedFields,
}: {
  readonly rejectedFields: CaptureSession["rejectedFields"];
}) {
  if (rejectedFields.length === 0) return null;
  return (
    <ul aria-label="取得できなかった項目">
      {rejectedFields.map((rejection) => (
        <li key={rejection.field}>
          {rejection.field}: {rejection.reason}
        </li>
      ))}
    </ul>
  );
}

function ReviewPanel({
  session,
  state,
  projects,
  error,
  onOpenDetailEdit,
}: {
  readonly session: CaptureSession;
  readonly state: CaptureState;
  readonly projects: readonly CaptureProjectOption[];
  readonly error: CaptureError | null;
  readonly onOpenDetailEdit: ((manualName?: string) => void) | undefined;
}) {
  const canProceed = resolvedName(session).length > 0;
  return (
    <section aria-label="取り込み確認" data-region="review">
      {error === null ? null : (
        <p className="product-capture__error" role="alert">
          {ERROR_MESSAGES[error.kind]}
        </p>
      )}
      {CAPTURE_CORE_FIELDS.map((field) =>
        field === "category" ? (
          <CategoryRow key={field} session={session} />
        ) : (
          <FieldRow
            field={field}
            key={field}
            onChange={(target, value) => state.updateField(target, value)}
            session={session}
          />
        ),
      )}
      <RejectedFields rejectedFields={session.rejectedFields} />
      <label>
        保存先プロジェクト
        <select
          data-capture-project-select
          onChange={(event) => {
            const projectId = event.target.value;
            if (projectId.length > 0) {
              state.selectProject(projectId as ProjectId);
            }
          }}
          value={session.projectId ?? ""}
        >
          <option value="">選択してください</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
      {projects.length === 0 ? (
        <p role="status">
          保存先のプロジェクトがありません。先にプロジェクトを作成してください。
        </p>
      ) : null}
      <button
        data-capture-submit
        disabled={!canProceed}
        onClick={() => void state.submit()}
        type="button"
      >
        保存
      </button>
      <button
        data-capture-open-detail-edit
        disabled={!canProceed}
        onClick={() => onOpenDetailEdit?.()}
        type="button"
      >
        詳細編集
      </button>
      <button
        data-capture-retry
        onClick={() => void state.startCapture()}
        type="button"
      >
        取り込み直す
      </button>
    </section>
  );
}

function IdleView({ onStart }: { readonly onStart: () => void }) {
  return (
    <section aria-label="取り込み">
      <p>拡張のアイコンから取り込みを開始してください。</p>
      <button data-capture-start onClick={onStart} type="button">
        取り込みを開始
      </button>
    </section>
  );
}

function ExtractingView() {
  return (
    <section aria-busy="true" aria-label="取り込み中">
      <p>ページを取り込んでいます…</p>
    </section>
  );
}

function SubmittingView() {
  return (
    <section aria-busy="true" aria-label="保存中">
      <p>保存しています…</p>
    </section>
  );
}

function SavedView({
  projectName,
  onCaptureAgain,
}: {
  readonly projectName: string | undefined;
  readonly onCaptureAgain: () => void;
}) {
  return (
    <section aria-label="保存完了">
      <p>
        {projectName === undefined
          ? "候補を保存しました。"
          : `候補を保存しました（保存先: ${projectName}）。`}
      </p>
      <button data-capture-start onClick={onCaptureAgain} type="button">
        別のページを取り込む
      </button>
    </section>
  );
}

function RetryGuidance({
  error,
  onRetry,
}: {
  readonly error: CaptureError;
  readonly onRetry: () => void;
}) {
  return (
    <section aria-label="取り込み失敗">
      <p role="alert">{ERROR_MESSAGES[error.kind]}</p>
      <button data-capture-retry onClick={onRetry} type="button">
        再実行
      </button>
    </section>
  );
}

function ManualEntryGuidance({
  onProceed,
}: {
  readonly onProceed: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const trimmed = name.trim();
  return (
    <section aria-label="手入力での登録案内">
      <p role="alert">
        {ERROR_MESSAGES["no-candidate"]}
        商品名を入力すると詳細編集へ進めます。
      </p>
      <label>
        商品名
        <input
          data-capture-manual-name
          onChange={(event) => setName(event.target.value)}
          value={name}
        />
      </label>
      <button
        data-capture-open-detail-edit
        disabled={trimmed.length === 0}
        onClick={() => onProceed(trimmed)}
        type="button"
      >
        詳細編集
      </button>
    </section>
  );
}

/** Renders feature-owned, framework-independent `CaptureState`; owns no domain logic itself. */
export function CaptureView({
  state,
  projects,
  onOpenDetailEdit,
}: CaptureViewProps) {
  useSyncExternalStore(
    (listener) => state.subscribe(listener),
    () => state.value,
    () => state.value,
  );
  const value = state.value;

  switch (value.status) {
    case "idle":
      return <IdleView onStart={() => void state.startCapture()} />;
    case "extracting":
      return <ExtractingView />;
    case "review":
      return (
        <ReviewPanel
          error={null}
          onOpenDetailEdit={onOpenDetailEdit}
          projects={projects}
          session={value.session}
          state={state}
        />
      );
    case "submitting":
      return <SubmittingView />;
    case "saved": {
      const projectName = projects.find(
        (project) => project.id === value.projectId,
      )?.name;
      return (
        <SavedView
          onCaptureAgain={() => void state.startCapture()}
          projectName={projectName}
        />
      );
    }
    case "failed":
      if (value.draft !== undefined) {
        return (
          <ReviewPanel
            error={value.error}
            onOpenDetailEdit={onOpenDetailEdit}
            projects={projects}
            session={value.draft}
            state={state}
          />
        );
      }
      if (value.error.kind === "no-candidate") {
        return (
          <ManualEntryGuidance onProceed={(name) => onOpenDetailEdit?.(name)} />
        );
      }
      return (
        <RetryGuidance
          error={value.error}
          onRetry={() => void state.startCapture()}
        />
      );
    default:
      return null;
  }
}
