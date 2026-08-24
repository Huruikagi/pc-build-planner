/**
 * 互換性確認。デザインキャンバス「3. 互換性確認」に対応する。
 *
 * `changes.md` C-2-1 の修正がここ。v0.4.0 はルール名・パーツ名・値・理由を
 * 区切りなしで連結し、
 * 「CPUソケットRyzen 7 9800X3DASUS ROG STRIX B650E-FAM5 / LGA1700規格が
 *  一致していません。」
 * と読めない表示になっていた。
 *
 * ルール名 / 判定バッジ / 対象 2 行（役割・パーツ名・値）/ 理由 1 文へ
 * 構造化し、理由はカタログ側で完結した 1 文として定義する。
 * **ここで文字列を組み立てない。**
 */
import { useMemo } from "react";

import {
  evaluate,
  type RuleResult,
  type Side,
  type Verdict,
} from "./compatibility.js";
import { t } from "./i18n.js";
import type { PartCategory } from "./model.js";
import type { ScreenProps } from "./screen-props.js";

const categoryLabel = (category: PartCategory): string =>
  t(`category_${category.replace("-", "_")}`);

const VERDICT_CLASS: Readonly<Record<Verdict, string>> = {
  compatible: "verdict--ok",
  incompatible: "verdict--ng",
  unknown: "verdict--unknown",
};

/** 理由は完結した 1 文。断片を連結しない (`changes.md` C-2-1)。 */
const reasonText = (result: RuleResult): string => {
  switch (result.reason) {
    case "missingLeft":
      return t(
        result.left.missing === "notSelected"
          ? "compatMissingNotSelected"
          : "compatMissingNotConfirmed",
        categoryLabel(result.left.role),
      );
    case "missingRight":
      return t(
        result.right.missing === "notSelected"
          ? "compatMissingNotSelected"
          : "compatMissingNotConfirmed",
        categoryLabel(result.right.role),
      );
    case "missingBoth":
      return t(
        "compatMissingBoth",
        categoryLabel(result.left.role),
        categoryLabel(result.right.role),
      );
    default:
      return t(`compatReason_${result.reason}`);
  }
};

const SideRow = ({ side }: { readonly side: Side }) => (
  <div className="verdict__side">
    <span className="verdict__role">{categoryLabel(side.role)}</span>
    <span
      className={
        side.part === null
          ? "verdict__part verdict__part--empty"
          : "verdict__part"
      }
    >
      {side.part?.name ?? t("buildUnselected")}
    </span>
    <span
      className={
        side.value === null
          ? "verdict__value verdict__value--empty"
          : "verdict__value"
      }
    >
      {side.value === null
        ? side.missing === "notSelected"
          ? "—"
          : t("compatNotConfirmed")
        : Array.isArray(side.value)
          ? side.value.join(" ")
          : side.value}
    </span>
  </div>
);

export const CompatibilityScreen = ({
  root,
  project,
  onNavigate,
}: ScreenProps) => {
  const evaluation = useMemo(() => evaluate(root, project.id), [root, project]);

  const { aggregate, results, incompatibleCount, unknownCount } = evaluation;

  return (
    <>
      <div className={`summary ${VERDICT_CLASS[aggregate]}`} role="status">
        <div className="summary__verdict" data-aggregate={aggregate}>
          {t(`compatAggregate_${aggregate}`)}
        </div>
        <div className="summary__detail">
          {t(
            "compatAggregateDetail",
            String(incompatibleCount),
            String(unknownCount),
          )}
        </div>
      </div>

      <div className="section-header">
        <span>{t("compatResults")}</span>
        <span>{t("compatRuleCount", String(results.length))}</span>
      </div>

      {results.map((result) => (
        <div
          className={`verdict ${VERDICT_CLASS[result.verdict]}`}
          data-rule={result.ruleId}
          data-verdict={result.verdict}
          key={result.id}
        >
          <div className="verdict__head">
            <span className="verdict__name">{t(`rule_${result.ruleId}`)}</span>
            <span className={`badge badge--${result.verdict}`}>
              {t(`compatVerdict_${result.verdict}`)}
            </span>
          </div>
          <SideRow side={result.left} />
          <SideRow side={result.right} />
          <div className="verdict__reason">{reasonText(result)}</div>
          {result.verdict === "unknown" ? (
            <button
              className="verdict__action"
              data-resolve-missing
              onClick={() =>
                onNavigate(
                  result.left.missing === "notSelected" ||
                    result.right.missing === "notSelected"
                    ? "build"
                    : "parts",
                )
              }
              type="button"
            >
              {result.left.missing === "notSelected" ||
              result.right.missing === "notSelected"
                ? t("compatResolveSelect")
                : t("compatResolveConfirm")}
            </button>
          ) : null}
        </div>
      ))}

      <p className="field-note field-note--wide">{t("compatPolicyNote")}</p>
    </>
  );
};
