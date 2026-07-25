import { useSyncExternalStore } from "react";

import type { MessageKey, MessageResolver } from "../../ui-messages/public.js";
import { useMessages } from "../../ui-messages/public.js";
import type {
  AggregateStatus,
  RuleId,
  RuleResult,
  RuleResultParty,
} from "./contracts.js";
import type {
  CompatibilityEmptyReason,
  CompatibilityFailureReason,
  CompatibilityState,
} from "./state.js";

const RULE_LABEL_KEYS = {
  "cpu-motherboard-socket": {
    name: "compatibility.rules.cpu-motherboard-socket.name",
    left: "compatibility.rules.cpu-motherboard-socket.left",
    right: "compatibility.rules.cpu-motherboard-socket.right",
  },
  "motherboard-memory-ddr": {
    name: "compatibility.rules.motherboard-memory-ddr.name",
    left: "compatibility.rules.motherboard-memory-ddr.left",
    right: "compatibility.rules.motherboard-memory-ddr.right",
  },
  "cooler-cpu-socket": {
    name: "compatibility.rules.cooler-cpu-socket.name",
    left: "compatibility.rules.cooler-cpu-socket.left",
    right: "compatibility.rules.cooler-cpu-socket.right",
  },
  "case-motherboard-form-factor": {
    name: "compatibility.rules.case-motherboard-form-factor.name",
    left: "compatibility.rules.case-motherboard-form-factor.left",
    right: "compatibility.rules.case-motherboard-form-factor.right",
  },
  "case-psu-form-factor": {
    name: "compatibility.rules.case-psu-form-factor.name",
    left: "compatibility.rules.case-psu-form-factor.left",
    right: "compatibility.rules.case-psu-form-factor.right",
  },
} as const satisfies Record<
  RuleId,
  Record<"name" | "left" | "right", MessageKey>
>;

type RuleLabelKeys = (typeof RULE_LABEL_KEYS)[RuleId];

type ReasonMessageKey =
  | "compatibility.reasons.value-equal"
  | "compatibility.reasons.value-not-equal"
  | "compatibility.reasons.value-included"
  | "compatibility.reasons.value-not-included"
  | "compatibility.reasons.input-missing";

const REASON_MESSAGE_KEYS: Readonly<Partial<Record<string, ReasonMessageKey>>> =
  {
    "value-equal": "compatibility.reasons.value-equal",
    "value-not-equal": "compatibility.reasons.value-not-equal",
    "value-included": "compatibility.reasons.value-included",
    "value-not-included": "compatibility.reasons.value-not-included",
    "input-missing": "compatibility.reasons.input-missing",
  };

const AGGREGATE_MESSAGE_KEYS = {
  compatible: "compatibility.aggregate.compatible",
  incompatible: "compatibility.aggregate.incompatible",
  caution: "compatibility.aggregate.caution",
  unknown: "compatibility.aggregate.unknown",
} as const satisfies Record<AggregateStatus, MessageKey>;

const EMPTY_MESSAGE_KEYS = {
  "no-build": "compatibility.empty.no-build",
  "invalid-reference": "compatibility.empty.invalid-reference",
} as const satisfies Record<CompatibilityEmptyReason, MessageKey>;

const FAILURE_MESSAGE_KEYS = {
  "corrupt-data": "compatibility.failure.corrupt-data",
  "unsupported-data": "compatibility.failure.unsupported-data",
  "read-failed": "compatibility.failure.read-failed",
} as const satisfies Record<CompatibilityFailureReason, MessageKey>;

const compareValueText = (
  value: string | readonly string[],
  messages: MessageResolver,
): string =>
  typeof value === "string"
    ? value
    : value.join(messages("common.listSeparator"));

const partyName = (
  labels: RuleLabelKeys,
  side: "left" | "right",
  party: RuleResultParty | undefined,
  messages: MessageResolver,
): string =>
  party?.displayName ??
  messages("compatibility.unselectedParty", { side: messages(labels[side]) });

const resultKey = (result: RuleResult): string =>
  `${result.ruleId}-${result.left?.candidatePartId ?? "none"}-${result.right?.candidatePartId ?? "none"}`;

function ResultRow({ result }: { readonly result: RuleResult }) {
  const messages = useMessages();
  const labels = RULE_LABEL_KEYS[result.ruleId];
  const reasonKey = REASON_MESSAGE_KEYS[result.reasonCode];
  return (
    <li data-result-status={result.status} data-rule-id={result.ruleId}>
      <span className="compatibility-result__rule-name">
        {messages(labels.name)}
      </span>
      {result.status === "unknown" ? (
        <>
          <span>{partyName(labels, "left", result.left, messages)}</span>
          <span>{partyName(labels, "right", result.right, messages)}</span>
          <ul aria-label={messages("compatibility.missingFieldsLabel")}>
            {result.missingFields.map((field) => (
              <li key={`${field.side}-${field.reason}`}>
                {field.reason === "category-missing"
                  ? messages("compatibility.missingCategory", {
                      side: messages(labels[field.side]),
                    })
                  : messages("compatibility.missingConfirmedValue", {
                      side: messages(labels[field.side]),
                    })}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <span>{result.left.displayName}</span>
          <span>{result.right.displayName}</span>
          <span>
            {compareValueText(result.comparedValue.left, messages)} /{" "}
            {compareValueText(result.comparedValue.right, messages)}
          </span>
        </>
      )}
      <span>
        {reasonKey === undefined ? result.reasonCode : messages(reasonKey)}
      </span>
    </li>
  );
}

/** Displays feature-owned CompatibilityState; renders all values as ordinary JSX children. */
export function CompatibilityView({
  state,
}: {
  readonly state: CompatibilityState;
}) {
  const messages = useMessages();
  const value = useSyncExternalStore(
    (listener) => state.subscribe(listener),
    () => state.value,
    () => state.value,
  );

  if (value.status === "idle") {
    return (
      <section
        aria-label={messages("compatibility.title")}
        className="compatibility compatibility--idle"
        data-status="idle"
      >
        <p>{messages("compatibility.idle")}</p>
      </section>
    );
  }

  if (value.status === "loading") {
    return (
      <section
        aria-label={messages("compatibility.title")}
        className="compatibility compatibility--loading"
        data-status="loading"
      >
        <p role="status">{messages("compatibility.loading")}</p>
      </section>
    );
  }

  if (value.status === "empty") {
    return (
      <section
        aria-label={messages("compatibility.title")}
        className="compatibility compatibility--empty"
        data-empty-reason={value.reason}
        data-status="empty"
      >
        <p>{messages(EMPTY_MESSAGE_KEYS[value.reason])}</p>
      </section>
    );
  }

  if (value.status === "failed") {
    return (
      <section
        aria-label={messages("compatibility.title")}
        className="compatibility compatibility--failed"
        data-failure-reason={value.reason}
        data-status="failed"
      >
        <p role="alert">{messages(FAILURE_MESSAGE_KEYS[value.reason])}</p>
      </section>
    );
  }

  const { report } = value;
  return (
    <section
      aria-label={messages("compatibility.title")}
      className={`compatibility compatibility--${report.status}`}
      data-aggregate-status={report.status}
      data-status="ready"
    >
      <p className="compatibility__summary">
        {messages(AGGREGATE_MESSAGE_KEYS[report.status])}
      </p>
      <ul aria-label={messages("compatibility.resultsLabel")}>
        {report.results.map((result) => (
          <ResultRow key={resultKey(result)} result={result} />
        ))}
      </ul>
    </section>
  );
}
