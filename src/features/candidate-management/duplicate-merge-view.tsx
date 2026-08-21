import type { ReactElement } from "react";

import type {
  CandidatePartId,
  PartCategory,
  SourcedValue,
} from "../../domain/public.js";
import { useMessages } from "../../ui-messages/public.js";
import type { DuplicateCandidateMatch } from "./duplicate-matcher.js";
import type { DuplicateMergeError } from "./duplicate-merge.js";
import type { DuplicateDecisionState } from "./duplicate-merge-state.js";
import type { ManagementFieldErrors } from "./state.js";

export interface DuplicateMergeViewProps {
  readonly fieldErrors?: ManagementFieldErrors;
  readonly state: DuplicateDecisionState;
  readonly onSelect: (candidateId: CandidatePartId) => void;
  readonly onSaveNew: () => void;
  readonly onMerge: () => void;
  readonly onCancel: () => void;
  readonly onRetry: () => void;
}

const categoryKeys: Readonly<Record<PartCategory, `category.${PartCategory}`>> =
  {
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
  };

const displayValue = (value: SourcedValue<string> | undefined): string => {
  if (value === undefined) return "—";
  const confirmed = value.confirmed?.trim();
  if (confirmed !== undefined && confirmed.length > 0) return confirmed;
  const original = value.original?.trim();
  return original === undefined || original.length === 0 ? "—" : original;
};

const errorKey = (error: DuplicateMergeError) => {
  if (error.kind === "stale-decision")
    return "candidate.duplicate.errors.stale" as const;
  if (error.kind === "source-route") {
    if (
      error.cause.kind === "source-refresh" &&
      error.cause.cause.kind === "ambiguous-match"
    )
      return "candidate.duplicate.errors.ambiguous" as const;
    return "candidate.duplicate.errors.source" as const;
  }
  if ("kind" in error.cause)
    return "candidate.duplicate.errors.unexpected" as const;
  switch (error.cause.code) {
    case "revision-conflict":
    case "request-conflict":
      return "candidate.duplicate.errors.conflict" as const;
    case "access-denied":
    case "lock-unavailable":
    case "storage-unavailable":
    case "quota-exceeded":
      return "candidate.duplicate.errors.storage" as const;
    case "validation":
      return "candidate.duplicate.errors.query" as const;
    default:
      return "candidate.duplicate.errors.unexpected" as const;
  }
};

function MatchSummary({
  match,
  selected,
  onSelect,
}: {
  readonly match: DuplicateCandidateMatch;
  readonly selected: boolean;
  readonly onSelect: (candidateId: CandidatePartId) => void;
}): ReactElement {
  const messages = useMessages();
  return (
    <li>
      <label>
        <input
          checked={selected}
          name="duplicate-merge-target"
          onChange={() => onSelect(match.candidateId)}
          type="radio"
          value={match.candidateId}
        />
        <strong>{displayValue(match.summary.name)}</strong>
      </label>
      <dl>
        <dt>{messages("candidate.duplicate.fields.manufacturer")}</dt>
        <dd>{displayValue(match.summary.manufacturer)}</dd>
        <dt>{messages("candidate.duplicate.fields.modelNumber")}</dt>
        <dd>{displayValue(match.summary.modelNumber)}</dd>
        <dt>{messages("candidate.duplicate.fields.category")}</dt>
        <dd>{messages(categoryKeys[match.summary.category])}</dd>
        <dt>{messages("candidate.duplicate.fields.confidence")}</dt>
        <dd>
          {messages(
            match.confidence === "high"
              ? "candidate.duplicate.confidence.high"
              : "candidate.duplicate.confidence.supporting",
          )}
        </dd>
        <dt>{messages("candidate.duplicate.fields.evidence")}</dt>
        <dd>
          {messages(
            match.evidence.kind === "model-number"
              ? "candidate.duplicate.evidence.modelNumber"
              : "candidate.duplicate.evidence.manufacturerName",
          )}
        </dd>
      </dl>
    </li>
  );
}

export function DuplicateMergeView({
  fieldErrors = {},
  state,
  onSelect,
  onSaveNew,
  onMerge,
  onCancel,
  onRetry,
}: DuplicateMergeViewProps): ReactElement | null {
  const messages = useMessages();
  if (state.status !== "deciding" && state.status !== "failed") return null;
  const selectedCandidateId =
    state.status === "deciding" ? state.selectedCandidateId : undefined;
  const sourceFieldError = Object.keys(fieldErrors).find((field) =>
    /^sources\[\d+\]\.pageUrl$/u.test(field),
  );

  return (
    <section
      aria-label={messages("candidate.duplicate.title")}
      data-region="duplicate-merge-decision"
    >
      <h3>{messages("candidate.duplicate.title")}</h3>
      <p>{messages("candidate.duplicate.description")}</p>
      {state.status === "failed" ? (
        <p role="alert">{messages(errorKey(state.error))}</p>
      ) : null}
      {sourceFieldError === undefined ? null : (
        <p data-field-error={sourceFieldError} role="alert">
          {messages("candidate.duplicate.errors.invalidSource")}
        </p>
      )}
      <fieldset>
        <legend>{messages("candidate.duplicate.candidateLabel")}</legend>
        <ol>
          {state.matches.map((match) => (
            <MatchSummary
              key={match.candidateId}
              match={match}
              onSelect={onSelect}
              selected={selectedCandidateId === match.candidateId}
            />
          ))}
        </ol>
      </fieldset>
      <button onClick={onSaveNew} type="button">
        {messages("candidate.duplicate.actions.saveNew")}
      </button>
      {state.status === "deciding" ? (
        <button
          disabled={selectedCandidateId === undefined}
          onClick={onMerge}
          type="button"
        >
          {messages("candidate.duplicate.actions.merge")}
        </button>
      ) : (
        <button onClick={onRetry} type="button">
          {messages("candidate.duplicate.actions.retry")}
        </button>
      )}
      <button onClick={onCancel} type="button">
        {messages("common.cancel")}
      </button>
    </section>
  );
}
