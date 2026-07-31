import { useSyncExternalStore } from "react";

import type { MessageKey, MessageResolver } from "../../ui-messages/public.js";
import { useMessages } from "../../ui-messages/public.js";
import type {
  SourcePriceRefreshError,
  SourcePriceRefreshReceipt,
  SourcePriceRefreshStateValue,
} from "./contracts.js";
import type { SourcePriceRefreshState } from "./state.js";

type FailureKind = SourcePriceRefreshError["kind"];

/** One stable cause line per failure kind. Never the raw error value. */
const causeMessageKeys = {
  "invalid-url": "sourcePriceRefresh.errors.invalid-url",
  "no-match": "sourcePriceRefresh.errors.no-match",
  "ambiguous-match": "sourcePriceRefresh.errors.ambiguous-match",
  "ineligible-source": "sourcePriceRefresh.errors.ineligible-source",
  "price-unavailable": "sourcePriceRefresh.errors.price-unavailable",
  "stale-activation": "sourcePriceRefresh.errors.stale-activation",
  "stale-target": "sourcePriceRefresh.errors.stale-target",
  "tab-unavailable": "sourcePriceRefresh.errors.tab-unavailable",
  "permission-lost": "sourcePriceRefresh.errors.permission-lost",
  "restricted-page": "sourcePriceRefresh.errors.restricted-page",
  "tab-changed": "sourcePriceRefresh.errors.tab-changed",
  "injection-failed": "sourcePriceRefresh.errors.injection-failed",
  "invalid-payload": "sourcePriceRefresh.errors.invalid-payload",
  validation: "sourcePriceRefresh.errors.validation",
  "unsupported-data": "sourcePriceRefresh.errors.unsupported-data",
  conflict: "sourcePriceRefresh.errors.conflict",
  maintenance: "sourcePriceRefresh.errors.maintenance",
  storage: "sourcePriceRefresh.errors.storage",
  quota: "sourcePriceRefresh.errors.quota",
} as const satisfies Record<FailureKind, MessageKey>;

/**
 * Recovery guidance per failure kind, taken from design.md's error table. The
 * grouping deliberately mirrors `isRecoverableSourcePriceRefreshError`: the
 * three repair-first entries (`reviewStoredSources`, `deduplicateSources`,
 * `repairStoredSource`) are exactly the kinds that classification reports as
 * non-recoverable, so the panel never invites a re-run the state considers
 * pointless. Kinds absent from the table follow the same rule the state's
 * documentation derives them from.
 */
const guidanceMessageKeys = {
  "no-match": "sourcePriceRefresh.guidance.reviewStoredSources",
  "ambiguous-match": "sourcePriceRefresh.guidance.deduplicateSources",
  validation: "sourcePriceRefresh.guidance.repairStoredSource",
  "unsupported-data": "sourcePriceRefresh.guidance.repairStoredSource",
  "ineligible-source": "sourcePriceRefresh.guidance.retryOnRetailSource",
  "invalid-url": "sourcePriceRefresh.guidance.retryOnEligiblePage",
  "restricted-page": "sourcePriceRefresh.guidance.retryOnEligiblePage",
  "price-unavailable": "sourcePriceRefresh.guidance.checkPageThenRetry",
  "permission-lost": "sourcePriceRefresh.guidance.retryFromContextMenu",
  "tab-changed": "sourcePriceRefresh.guidance.retryFromContextMenu",
  "tab-unavailable": "sourcePriceRefresh.guidance.retryFromContextMenu",
  "injection-failed": "sourcePriceRefresh.guidance.retryFromContextMenu",
  "invalid-payload": "sourcePriceRefresh.guidance.retryFromContextMenu",
  "stale-activation": "sourcePriceRefresh.guidance.retryFromContextMenu",
  "stale-target": "sourcePriceRefresh.guidance.reloadCandidateThenRetry",
  conflict: "sourcePriceRefresh.guidance.reloadCandidateThenRetry",
  maintenance: "sourcePriceRefresh.guidance.retryAfterMaintenance",
  storage: "sourcePriceRefresh.guidance.checkStorageThenRetry",
  quota: "sourcePriceRefresh.guidance.checkStorageThenRetry",
} as const satisfies Record<FailureKind, MessageKey>;

/**
 * Confirmed amount and currency only. The page-derived `original` is never
 * rendered, and a receipt without a confirmed money value reports a missing
 * value rather than inventing one.
 */
const priceText = (
  receipt: SourcePriceRefreshReceipt,
  messages: MessageResolver,
): string => {
  const confirmed = receipt.price.confirmed;
  return confirmed === undefined
    ? messages("common.notEntered")
    : messages("sourcePriceRefresh.priceValue", {
        amount: confirmed.amount,
        currency: confirmed.currency,
      });
};

function SucceededSummary({
  receipt,
  messages,
}: {
  readonly receipt: SourcePriceRefreshReceipt;
  readonly messages: MessageResolver;
}) {
  return (
    <div data-status="succeeded">
      <p role="status">{messages("sourcePriceRefresh.succeededStatus")}</p>
      <dl>
        <dt>{messages("sourcePriceRefresh.priceLabel")}</dt>
        <dd data-field="price">{priceText(receipt, messages)}</dd>
        <dt>{messages("sourcePriceRefresh.capturedAtLabel")}</dt>
        <dd data-field="captured-at">{receipt.capturedAt}</dd>
        <dt>{messages("sourcePriceRefresh.primaryLabel")}</dt>
        <dd data-field="primary">
          {messages(
            receipt.isPrimary
              ? "sourcePriceRefresh.primaryUpdated"
              : "sourcePriceRefresh.primaryUnchanged",
          )}
        </dd>
      </dl>
    </div>
  );
}

function FailureSummary({
  kind,
  messages,
}: {
  readonly kind: FailureKind;
  readonly messages: MessageResolver;
}) {
  return (
    <div data-status="failed">
      <p role="alert">{messages("sourcePriceRefresh.failedStatus")}</p>
      <p data-region="cause">{messages(causeMessageKeys[kind])}</p>
      <p data-region="recovery-guidance">
        {messages(guidanceMessageKeys[kind])}
      </p>
      <p data-region="preserved">
        {messages("sourcePriceRefresh.preservedNotice")}
      </p>
    </div>
  );
}

const body = (
  value: SourcePriceRefreshStateValue,
  messages: MessageResolver,
) => {
  switch (value.status) {
    case "running":
      return (
        <p data-status="running" role="status">
          {messages("sourcePriceRefresh.runningStatus")}
        </p>
      );
    case "succeeded":
      return <SucceededSummary messages={messages} receipt={value.receipt} />;
    case "failed":
      return <FailureSummary kind={value.error.kind} messages={messages} />;
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
};

/**
 * Summary-only transient surface for one price refresh activation. It presents
 * progress, the refreshed money with its capture time, or a stable cause and
 * recovery guidance. It deliberately offers no re-run control, and renders no
 * URL, product value, raw markup or exception detail; every external string it
 * does show (currency, capture time) is a plain JSX child, never markup.
 */
export function SourcePriceRefreshView({
  state,
}: {
  readonly state: SourcePriceRefreshState;
}) {
  const messages = useMessages();
  useSyncExternalStore(
    (listener) => state.subscribe(listener),
    () => state.value,
    () => state.value,
  );
  const value = state.value;
  return (
    <section
      aria-label={messages("sourcePriceRefresh.title")}
      className="source-price-refresh"
    >
      {value === null ? null : body(value, messages)}
    </section>
  );
}
