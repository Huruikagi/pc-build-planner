/**
 * 互換性判定。`docs/reverse/features.md` 5 章に対応する。
 *
 * **判定の入力は、現在構成に採用されているパーツの `confirmed` 値だけ。**
 * 取り込んだままの `original` は使わない。これが「不確かな情報から互換性を
 * 断定しない」を保証する仕組み (`features.md` 5.1 / 1.2)。
 *
 * **情報不足は不整合ではない。** 3 値を返し、不足している側だけを名指しする
 * (5.3)。ここを混ぜないことが絶対条件。
 */
import { buildRows } from "./build.js";
import type {
  CandidatePart,
  LocalDataRoot,
  PartCategory,
  SourcedAttribute,
} from "./model.js";

export type Verdict = "compatible" | "incompatible" | "unknown";

/** どちらの側が、なぜ足りないか。 */
export type MissingKind = "notSelected" | "notConfirmed";

export interface Side {
  readonly role: PartCategory;
  readonly part: CandidatePart | null;
  /** 確認済みの値。単数の規格か、対応範囲の一覧。 */
  readonly value: string | readonly string[] | null;
  readonly missing: MissingKind | null;
}

export type ReasonKind =
  | "valueEqual"
  | "valueNotEqual"
  | "valueIncluded"
  | "valueNotIncluded"
  | "missingLeft"
  | "missingRight"
  | "missingBoth";

export interface RuleResult {
  readonly id: string;
  readonly ruleId: RuleId;
  readonly verdict: Verdict;
  readonly reason: ReasonKind;
  readonly left: Side;
  readonly right: Side;
}

type Comparison = "equal" | "included";

interface Rule {
  readonly id: RuleId;
  readonly left: { readonly role: PartCategory; readonly attribute: string };
  readonly right: { readonly role: PartCategory; readonly attribute: string };
  readonly comparison: Comparison;
}

export type RuleId =
  | "cpuMotherboardSocket"
  | "motherboardMemoryStandard"
  | "coolerCpuSocket"
  | "caseMotherboardFormFactor"
  | "casePowerSupplyFormFactor";

/** 判定できる基本規格。ここを増やすことは判定範囲を広げること。 */
export const RULES: readonly Rule[] = [
  {
    id: "cpuMotherboardSocket",
    left: { role: "cpu", attribute: "socket" },
    right: { role: "motherboard", attribute: "socket" },
    comparison: "equal",
  },
  {
    id: "motherboardMemoryStandard",
    left: { role: "motherboard", attribute: "memoryStandard" },
    right: { role: "memory", attribute: "memoryStandard" },
    comparison: "equal",
  },
  {
    id: "coolerCpuSocket",
    left: { role: "cpu", attribute: "socket" },
    right: { role: "cpu-cooler", attribute: "supportedSockets" },
    comparison: "included",
  },
  {
    id: "caseMotherboardFormFactor",
    left: { role: "motherboard", attribute: "formFactor" },
    right: { role: "case", attribute: "supportedMotherboardFormFactors" },
    comparison: "included",
  },
  {
    id: "casePowerSupplyFormFactor",
    left: { role: "power-supply", attribute: "formFactor" },
    right: { role: "case", attribute: "supportedPowerSupplyFormFactors" },
    comparison: "included",
  },
];

/** 確認済みの値だけを取り出す。`original` しか無い値は無いものとして扱う。 */
const confirmedValue = (
  part: CandidatePart,
  attribute: string,
): string | readonly string[] | null => {
  const value: SourcedAttribute | undefined = part.attributes[attribute];
  return value?.confirmed ?? null;
};

const sideFor = (
  adopted: ReadonlyMap<PartCategory, readonly CandidatePart[]>,
  spec: { readonly role: PartCategory; readonly attribute: string },
  part: CandidatePart | null,
): Side => {
  if (part === null)
    return {
      role: spec.role,
      part: null,
      value: null,
      missing:
        (adopted.get(spec.role) ?? []).length === 0
          ? "notSelected"
          : "notConfirmed",
    };
  const value = confirmedValue(part, spec.attribute);
  return {
    role: spec.role,
    part,
    value,
    missing: value === null ? "notConfirmed" : null,
  };
};

/** 規格名は表記ゆれを畳んで比較する。値そのものは書き換えない。 */
const fold = (value: string): string =>
  value.trim().normalize("NFKC").toUpperCase();

const compare = (
  comparison: Comparison,
  left: string | readonly string[],
  right: string | readonly string[],
): boolean => {
  if (comparison === "equal")
    return (
      typeof left === "string" &&
      typeof right === "string" &&
      fold(left) === fold(right)
    );
  /** 包含は「左の単一の規格が、右の対応範囲に入っているか」。 */
  const needle = typeof left === "string" ? fold(left) : null;
  const haystack = Array.isArray(right) ? right : [];
  return needle !== null && haystack.some((entry) => fold(entry) === needle);
};

const evaluatePair = (
  rule: Rule,
  left: Side,
  right: Side,
  index: number,
): RuleResult => {
  const id = `${rule.id}-${index}`;

  if (left.missing !== null && right.missing !== null)
    return {
      id,
      ruleId: rule.id,
      verdict: "unknown",
      reason: "missingBoth",
      left,
      right,
    };
  if (left.missing !== null)
    return {
      id,
      ruleId: rule.id,
      verdict: "unknown",
      reason: "missingLeft",
      left,
      right,
    };
  if (right.missing !== null)
    return {
      id,
      ruleId: rule.id,
      verdict: "unknown",
      reason: "missingRight",
      left,
      right,
    };
  if (left.value === null || right.value === null)
    return {
      id,
      ruleId: rule.id,
      verdict: "unknown",
      reason: "missingBoth",
      left,
      right,
    };

  const matched = compare(rule.comparison, left.value, right.value);
  return {
    id,
    ruleId: rule.id,
    verdict: matched ? "compatible" : "incompatible",
    reason:
      rule.comparison === "equal"
        ? matched
          ? "valueEqual"
          : "valueNotEqual"
        : matched
          ? "valueIncluded"
          : "valueNotIncluded",
    left,
    right,
  };
};

export interface Evaluation {
  readonly results: readonly RuleResult[];
  readonly aggregate: Verdict;
  readonly incompatibleCount: number;
  readonly unknownCount: number;
}

/**
 * 現在構成を評価する。
 *
 * 片側に複数のパーツが採用されている場合（メモリ 2 枚など）は、その組み合わせ
 * ごとに 1 件返す。どのパーツが合わないのかを具体的に示すため。
 */
export const evaluate = (
  root: LocalDataRoot,
  projectId: string | null,
): Evaluation => {
  const adopted = new Map<PartCategory, readonly CandidatePart[]>(
    buildRows(root, projectId).map((row) => [
      row.category,
      row.entries.map((entry) => entry.part),
    ]),
  );

  const results: RuleResult[] = [];
  for (const rule of RULES) {
    const lefts = adopted.get(rule.left.role) ?? [];
    const rights = adopted.get(rule.right.role) ?? [];

    /** どちらも未採用でも、判定できないことを 1 件として必ず示す。 */
    if (lefts.length === 0 && rights.length === 0) {
      results.push(
        evaluatePair(
          rule,
          sideFor(adopted, rule.left, null),
          sideFor(adopted, rule.right, null),
          0,
        ),
      );
      continue;
    }

    const leftCandidates = lefts.length === 0 ? [null] : lefts;
    const rightCandidates = rights.length === 0 ? [null] : rights;
    let index = 0;
    for (const left of leftCandidates)
      for (const right of rightCandidates) {
        results.push(
          evaluatePair(
            rule,
            sideFor(adopted, rule.left, left),
            sideFor(adopted, rule.right, right),
            index,
          ),
        );
        index += 1;
      }
  }

  const incompatibleCount = results.filter(
    (result) => result.verdict === "incompatible",
  ).length;
  const unknownCount = results.filter(
    (result) => result.verdict === "unknown",
  ).length;

  /**
   * 1 件でも不一致があれば互換性なし。不一致が無く情報不足を含めば判定不能。
   * **情報不足を不整合と誤認しない** (`features.md` 5.4)。
   */
  const aggregate: Verdict =
    incompatibleCount > 0
      ? "incompatible"
      : unknownCount > 0
        ? "unknown"
        : "compatible";

  return { results, aggregate, incompatibleCount, unknownCount };
};
