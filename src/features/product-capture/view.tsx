import { useState, useSyncExternalStore } from "react";
import type { PartCategory, ProjectId } from "../../domain/public.js";
import type { MessageKey } from "../../ui-messages/public.js";
import { useMessages } from "../../ui-messages/public.js";
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

const fieldMessageKeys = {
  name: "capture.fields.name",
  category: "capture.fields.category",
  price: "capture.fields.price",
  manufacturer: "capture.fields.manufacturer",
  modelNumber: "capture.fields.modelNumber",
  url: "capture.fields.url",
} as const satisfies Record<CaptureCoreField, MessageKey>;

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

const sourceMessageKeys = {
  "json-ld": "capture.sources.json-ld",
  meta: "capture.sources.meta",
  heading: "capture.sources.heading",
  breadcrumb: "capture.sources.breadcrumb",
  table: "capture.sources.table",
  "definition-list": "capture.sources.definition-list",
  "domain-map": "capture.sources.domain-map",
} as const satisfies Record<ExtractionSource, MessageKey>;

const errorMessageKeys = {
  "permission-lost": "capture.errors.permission-lost",
  "restricted-page": "capture.errors.restricted-page",
  "tab-changed": "capture.errors.tab-changed",
  "injection-failed": "capture.errors.injection-failed",
  "invalid-payload": "capture.errors.invalid-payload",
  "no-candidate": "capture.errors.no-candidate",
  validation: "persistenceError.validation",
  "project-required": "capture.errors.project-required",
  navigation: "capture.errors.navigation",
  maintenance: "persistenceError.maintenance",
  storage: "capture.errors.storage",
  quota: "persistenceError.quota",
  "unsupported-data": "capture.errors.unsupportedData",
} as const satisfies Record<CaptureError["kind"], MessageKey>;

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
  const messages = useMessages();
  const entry = fieldEntry(session, field);
  const missing = session.missingCoreFields.includes(field);
  return (
    <div className="product-capture__field" data-capture-field-row={field}>
      <label>
        {messages(fieldMessageKeys[field])}
        <input
          data-capture-field={field}
          onChange={(event) => onChange(field, event.target.value)}
          value={resolvedFieldText(session, field)}
        />
      </label>
      {entry === undefined ? null : (
        <p className="product-capture__source">
          {messages("capture.sourceAttribution", {
            source: messages(sourceMessageKeys[entry.source]),
            sourceLabel: entry.sourceLabel,
          })}
        </p>
      )}
      {entry?.value.original === null ||
      entry?.value.original === undefined ? null : entry.value.original
          .length === 0 ? null : (
        <p className="product-capture__original">
          {messages("capture.originalValueLabel", {
            value: entry.value.original,
          })}
        </p>
      )}
      {missing ? (
        <p className="product-capture__missing" role="status">
          {messages("capture.missingFieldStatus")}
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
  const messages = useMessages();
  const entry = fieldEntry(session, "category");
  const text = resolvedFieldText(session, "category");
  const hint = inferCategoryHint(text);
  const missing = session.missingCoreFields.includes("category");
  return (
    <div className="product-capture__field" data-capture-field-row="category">
      <p className="product-capture__field-label">
        {messages(fieldMessageKeys.category)}
      </p>
      <p className="product-capture__category-hint" data-capture-category-hint>
        {hint === undefined
          ? messages("capture.categoryHintUnknown")
          : messages("capture.categoryHintEstimated", {
              label: messages(categoryMessageKeys[hint]),
            })}
      </p>
      {entry === undefined ? null : (
        <p className="product-capture__source">
          {messages("capture.sourceAttribution", {
            source: messages(sourceMessageKeys[entry.source]),
            sourceLabel: entry.sourceLabel,
          })}
        </p>
      )}
      {entry?.value.original === null ||
      entry?.value.original === undefined ? null : entry.value.original
          .length === 0 ? null : (
        <p className="product-capture__original">
          {messages("capture.originalValueLabel", {
            value: entry.value.original,
          })}
        </p>
      )}
      {missing ? (
        <p className="product-capture__missing" role="status">
          {messages("capture.missingFieldStatus")}
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
  const messages = useMessages();
  if (rejectedFields.length === 0) return null;
  return (
    <ul aria-label={messages("capture.rejectedFieldsLabel")}>
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
  const messages = useMessages();
  const canProceed = resolvedName(session).length > 0;
  return (
    <section aria-label={messages("capture.reviewTitle")} data-region="review">
      {error === null ? null : (
        <p className="product-capture__error" role="alert">
          {messages(errorMessageKeys[error.kind])}
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
        {messages("capture.saveDestinationLabel")}
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
          <option value="">{messages("capture.selectPrompt")}</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
      {projects.length === 0 ? (
        <p role="status">{messages("capture.noProjectsNotice")}</p>
      ) : null}
      <button
        data-capture-submit
        disabled={!canProceed}
        onClick={() => void state.submit()}
        type="button"
      >
        {messages("common.save")}
      </button>
      <button
        data-capture-open-detail-edit
        disabled={!canProceed}
        onClick={() => onOpenDetailEdit?.()}
        type="button"
      >
        {messages("capture.detailEditAction")}
      </button>
      <button
        data-capture-retry
        onClick={() => void state.startCapture()}
        type="button"
      >
        {messages("capture.retryCaptureAction")}
      </button>
    </section>
  );
}

function IdleView({ onStart }: { readonly onStart: () => void }) {
  const messages = useMessages();
  return (
    <section aria-label={messages("capture.idleTitle")}>
      <p>{messages("capture.idleInstruction")}</p>
      <button data-capture-start onClick={onStart} type="button">
        {messages("capture.startAction")}
      </button>
    </section>
  );
}

function ExtractingView() {
  const messages = useMessages();
  return (
    <section aria-busy="true" aria-label={messages("capture.extractingTitle")}>
      <p>{messages("capture.extractingStatus")}</p>
    </section>
  );
}

function SubmittingView() {
  const messages = useMessages();
  return (
    <section aria-busy="true" aria-label={messages("capture.submittingTitle")}>
      <p>{messages("capture.submittingStatus")}</p>
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
  const messages = useMessages();
  return (
    <section aria-label={messages("capture.savedTitle")}>
      <p>
        {projectName === undefined
          ? messages("capture.savedWithoutProject")
          : messages("capture.savedWithProject", { projectName })}
      </p>
      <button data-capture-start onClick={onCaptureAgain} type="button">
        {messages("capture.captureAnotherAction")}
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
  const messages = useMessages();
  return (
    <section aria-label={messages("capture.failedTitle")}>
      <p role="alert">{messages(errorMessageKeys[error.kind])}</p>
      <button data-capture-retry onClick={onRetry} type="button">
        {messages("capture.retryAction")}
      </button>
    </section>
  );
}

function ManualEntryGuidance({
  onProceed,
}: {
  readonly onProceed: (name: string) => void;
}) {
  const messages = useMessages();
  const [name, setName] = useState("");
  const trimmed = name.trim();
  return (
    <section aria-label={messages("capture.manualEntryTitle")}>
      <p role="alert">
        {messages(errorMessageKeys["no-candidate"])}
        {messages("capture.manualEntryInstruction")}
      </p>
      <label>
        {messages(fieldMessageKeys.name)}
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
        {messages("capture.detailEditAction")}
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
