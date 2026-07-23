import assert from "node:assert/strict";
import test from "node:test";
import type { CandidatePartId } from "../../../src/domain/public.js";
import { resultAggregator } from "../../../src/features/compatibility/aggregator.js";
import type {
  RuleId,
  RuleResult,
  RuleResultParty,
} from "../../../src/features/compatibility/contracts.js";

const partId = (raw: string): CandidatePartId =>
  raw as unknown as CandidatePartId;

const party = (raw: string, displayName: string): RuleResultParty => ({
  candidatePartId: partId(raw),
  displayName,
});

const compatible = (ruleId: RuleId): RuleResult => ({
  ruleId,
  status: "compatible",
  left: party("1", "架空左"),
  right: party("2", "架空右"),
  comparedValue: { left: "AM5", right: "AM5" },
  reasonCode: "value-equal",
});

const incompatible = (ruleId: RuleId): RuleResult => ({
  ruleId,
  status: "incompatible",
  left: party("1", "架空左"),
  right: party("2", "架空右"),
  comparedValue: { left: "AM5", right: "LGA1700" },
  reasonCode: "value-not-equal",
});

const unknown = (ruleId: RuleId): RuleResult => ({
  ruleId,
  status: "unknown",
  missingFields: [{ side: "left", reason: "category-missing" }],
  reasonCode: "input-missing",
});

test("非互換が一件でもあれば他の結果に関わらず互換性なしとする", () => {
  const results: readonly RuleResult[] = [
    compatible("cpu-motherboard-socket"),
    incompatible("motherboard-memory-ddr"),
    unknown("cooler-cpu-socket"),
  ];
  assert.equal(resultAggregator.aggregate(results), "incompatible");
});

test("非互換がなく互換と判定不能が混在すれば注意事項ありとする", () => {
  const results: readonly RuleResult[] = [
    compatible("cpu-motherboard-socket"),
    unknown("motherboard-memory-ddr"),
  ];
  assert.equal(resultAggregator.aggregate(results), "caution");
});

test("すべて互換性ありなら互換性ありとする", () => {
  const results: readonly RuleResult[] = [
    compatible("cpu-motherboard-socket"),
    compatible("motherboard-memory-ddr"),
    compatible("cooler-cpu-socket"),
    compatible("case-motherboard-form-factor"),
    compatible("case-psu-form-factor"),
  ];
  assert.equal(resultAggregator.aggregate(results), "compatible");
});

test("評価可能な結果がなく判定不能だけなら判定不能とする", () => {
  const results: readonly RuleResult[] = [
    unknown("cpu-motherboard-socket"),
    unknown("motherboard-memory-ddr"),
  ];
  assert.equal(resultAggregator.aggregate(results), "unknown");
});

test("個別結果が空でも判定不能とする", () => {
  assert.equal(resultAggregator.aggregate([]), "unknown");
});

test("入力順序が変わっても同じ集約statusを返す", () => {
  const forward: readonly RuleResult[] = [
    unknown("cpu-motherboard-socket"),
    incompatible("motherboard-memory-ddr"),
    compatible("cooler-cpu-socket"),
  ];
  const reversed = [...forward].reverse();
  const shuffled = [
    forward[1] as RuleResult,
    forward[2] as RuleResult,
    forward[0] as RuleResult,
  ];

  const expected = resultAggregator.aggregate(forward);
  assert.equal(resultAggregator.aggregate(reversed), expected);
  assert.equal(resultAggregator.aggregate(shuffled), expected);
  assert.equal(expected, "incompatible");
});

test("入力順序が変わってもcautionの判定は変わらない", () => {
  const forward: readonly RuleResult[] = [
    compatible("cpu-motherboard-socket"),
    unknown("motherboard-memory-ddr"),
  ];
  const reversed = [...forward].reverse();

  assert.equal(resultAggregator.aggregate(forward), "caution");
  assert.equal(resultAggregator.aggregate(reversed), "caution");
});
