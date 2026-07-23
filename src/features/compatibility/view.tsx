import { useSyncExternalStore } from "react";

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

interface RuleLabel {
  readonly name: string;
  readonly left: string;
  readonly right: string;
}

const RULE_LABELS: Readonly<Record<RuleId, RuleLabel>> = {
  "cpu-motherboard-socket": {
    name: "CPUソケット",
    left: "CPU",
    right: "マザーボード",
  },
  "motherboard-memory-ddr": {
    name: "メモリ規格",
    left: "マザーボード",
    right: "メモリ",
  },
  "cooler-cpu-socket": {
    name: "CPUクーラー対応ソケット",
    left: "CPU",
    right: "CPUクーラー",
  },
  "case-motherboard-form-factor": {
    name: "ケース対応フォームファクタ",
    left: "マザーボード",
    right: "ケース",
  },
  "case-psu-form-factor": {
    name: "ケース対応電源規格",
    left: "電源",
    right: "ケース",
  },
};

const REASON_LABELS: Readonly<Record<string, string>> = {
  "value-equal": "規格が一致しています。",
  "value-not-equal": "規格が一致していません。",
  "value-included": "対応範囲に含まれています。",
  "value-not-included": "対応範囲に含まれていません。",
  "input-missing": "必要な確認済み情報が不足しています。",
};

const AGGREGATE_LABELS: Readonly<Record<AggregateStatus, string>> = {
  compatible: "互換性あり",
  incompatible: "互換性なし",
  caution: "注意事項あり",
  unknown: "情報不足で判定不能",
};

const EMPTY_MESSAGES: Readonly<Record<CompatibilityEmptyReason, string>> = {
  "no-build": "現在構成が選択されていません。パーツを選択してください。",
  "invalid-reference":
    "現在構成に不正な参照が含まれています。構成を確認してください。",
};

const FAILURE_MESSAGES: Readonly<Record<CompatibilityFailureReason, string>> = {
  "corrupt-data": "保存データが破損しています。互換性を判定できません。",
  "unsupported-data":
    "保存データが対応していない形式です。互換性を判定できません。",
  "read-failed": "データを読み込めませんでした。互換性を判定できません。",
};

const compareValueText = (value: string | readonly string[]): string =>
  typeof value === "string" ? value : value.join("、");

const partyName = (
  labels: RuleLabel,
  side: "left" | "right",
  party: RuleResultParty | undefined,
): string => party?.displayName ?? `${labels[side]}（未選択）`;

const resultKey = (result: RuleResult): string =>
  `${result.ruleId}-${result.left?.candidatePartId ?? "none"}-${result.right?.candidatePartId ?? "none"}`;

function ResultRow({ result }: { readonly result: RuleResult }) {
  const labels = RULE_LABELS[result.ruleId];
  return (
    <li data-result-status={result.status} data-rule-id={result.ruleId}>
      <span className="compatibility-result__rule-name">{labels.name}</span>
      {result.status === "unknown" ? (
        <>
          <span>{partyName(labels, "left", result.left)}</span>
          <span>{partyName(labels, "right", result.right)}</span>
          <ul aria-label="不足項目">
            {result.missingFields.map((field) => (
              <li key={`${field.side}-${field.reason}`}>
                {labels[field.side]}
                {field.reason === "category-missing"
                  ? "が選択されていません。"
                  : "の値が未確認です。"}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <span>{result.left.displayName}</span>
          <span>{result.right.displayName}</span>
          <span>
            {compareValueText(result.comparedValue.left)} /{" "}
            {compareValueText(result.comparedValue.right)}
          </span>
        </>
      )}
      <span>{REASON_LABELS[result.reasonCode] ?? result.reasonCode}</span>
    </li>
  );
}

/** Displays feature-owned CompatibilityState; renders all values as ordinary JSX children. */
export function CompatibilityView({
  state,
}: {
  readonly state: CompatibilityState;
}) {
  const value = useSyncExternalStore(
    (listener) => state.subscribe(listener),
    () => state.value,
    () => state.value,
  );

  if (value.status === "idle") {
    return (
      <section
        aria-label="互換性確認"
        className="compatibility compatibility--idle"
        data-status="idle"
      >
        <p>互換性の評価を開始してください。</p>
      </section>
    );
  }

  if (value.status === "loading") {
    return (
      <section
        aria-label="互換性確認"
        className="compatibility compatibility--loading"
        data-status="loading"
      >
        <p role="status">評価しています…</p>
      </section>
    );
  }

  if (value.status === "empty") {
    return (
      <section
        aria-label="互換性確認"
        className="compatibility compatibility--empty"
        data-empty-reason={value.reason}
        data-status="empty"
      >
        <p>{EMPTY_MESSAGES[value.reason]}</p>
      </section>
    );
  }

  if (value.status === "failed") {
    return (
      <section
        aria-label="互換性確認"
        className="compatibility compatibility--failed"
        data-failure-reason={value.reason}
        data-status="failed"
      >
        <p role="alert">{FAILURE_MESSAGES[value.reason]}</p>
      </section>
    );
  }

  const { report } = value;
  return (
    <section
      aria-label="互換性確認"
      className={`compatibility compatibility--${report.status}`}
      data-aggregate-status={report.status}
      data-status="ready"
    >
      <p className="compatibility__summary">
        {AGGREGATE_LABELS[report.status]}
      </p>
      <ul aria-label="個別判定結果">
        {report.results.map((result) => (
          <ResultRow key={resultKey(result)} result={result} />
        ))}
      </ul>
    </section>
  );
}
