import assert from "node:assert/strict";
import test from "node:test";
import type { CandidatePartId } from "../../../src/domain/public.js";
import type {
  CompatibilityValue,
  RuleId,
  RuleResult,
  RuleTarget,
  RuleTargetParty,
} from "../../../src/features/compatibility/contracts.js";
import { RULE_REGISTRY } from "../../../src/features/compatibility/rules.js";

const partId = (raw: string): CandidatePartId =>
  raw as unknown as CandidatePartId;

const cpuId = partId("11111111-1111-4111-8111-111111111111");
const motherboardId = partId("22222222-2222-4222-8222-222222222222");
const coolerId = partId("33333333-3333-4333-8333-333333333333");
const memoryId = partId("44444444-4444-4444-8444-444444444444");
const caseId = partId("55555555-5555-4555-8555-555555555555");
const psuId = partId("66666666-6666-4666-8666-666666666666");

const present = (
  candidatePartId: CandidatePartId,
  displayName: string,
  value?: CompatibilityValue,
): RuleTargetParty =>
  value === undefined
    ? { kind: "present", candidatePartId, displayName }
    : { kind: "present", candidatePartId, displayName, value };

const absent: RuleTargetParty = { kind: "absent" };

const ruleFor = (ruleId: RuleId) => {
  const found = RULE_REGISTRY.find((candidate) => candidate.id === ruleId);
  assert.ok(found, `expected rule ${ruleId} to be registered`);
  return found;
};

/**
 * One fixture per fixed rule, covering both an equality-style rule
 * (cpu-motherboard-socket, motherboard-memory-ddr) and containment-style
 * rules (the remaining three), each with a left/right party pair and a
 * confirmed value that matches or mismatches deterministically.
 */
interface RuleFixture {
  readonly ruleId: RuleId;
  readonly leftId: CandidatePartId;
  readonly leftName: string;
  readonly rightId: CandidatePartId;
  readonly rightName: string;
  readonly matching: {
    readonly left: CompatibilityValue;
    readonly right: CompatibilityValue;
  };
  readonly mismatching: {
    readonly left: CompatibilityValue;
    readonly right: CompatibilityValue;
  };
}

const RULE_FIXTURES: readonly RuleFixture[] = [
  {
    ruleId: "cpu-motherboard-socket",
    leftId: cpuId,
    leftName: "架空CPU",
    rightId: motherboardId,
    rightName: "架空マザーボード",
    matching: { left: "AM5", right: "AM5" },
    mismatching: { left: "AM5", right: "LGA1700" },
  },
  {
    ruleId: "motherboard-memory-ddr",
    leftId: motherboardId,
    leftName: "架空マザーボード",
    rightId: memoryId,
    rightName: "架空メモリ",
    matching: { left: "DDR5", right: "DDR5" },
    mismatching: { left: "DDR5", right: "DDR4" },
  },
  {
    ruleId: "cooler-cpu-socket",
    leftId: cpuId,
    leftName: "架空CPU",
    rightId: coolerId,
    rightName: "架空クーラー",
    matching: { left: "AM5", right: ["AM4", "AM5"] },
    mismatching: { left: "LGA1700", right: ["AM4", "AM5"] },
  },
  {
    ruleId: "case-motherboard-form-factor",
    leftId: motherboardId,
    leftName: "架空マザーボード",
    rightId: caseId,
    rightName: "架空ケース",
    matching: { left: "Micro-ATX", right: ["ATX", "Micro-ATX"] },
    mismatching: { left: "E-ATX", right: ["ATX", "Micro-ATX"] },
  },
  {
    ruleId: "case-psu-form-factor",
    leftId: psuId,
    leftName: "架空電源",
    rightId: caseId,
    rightName: "架空ケース",
    matching: { left: "ATX", right: ["ATX", "SFX"] },
    mismatching: { left: "SFX-L", right: ["ATX", "SFX"] },
  },
];

test("RULE_REGISTRY registers exactly the five fixed rules", () => {
  const expected: readonly RuleId[] = RULE_FIXTURES.map((f) => f.ruleId);
  assert.deepEqual(
    [...RULE_REGISTRY.map((rule) => rule.id)].sort(),
    [...expected].sort(),
  );
  assert.equal(RULE_REGISTRY.length, 5);
});

for (const fixture of RULE_FIXTURES) {
  const rule = () => ruleFor(fixture.ruleId);

  test(`${fixture.ruleId}: 一致する確認済み値は互換性ありとする`, () => {
    const target: RuleTarget = {
      ruleId: fixture.ruleId,
      left: present(fixture.leftId, fixture.leftName, fixture.matching.left),
      right: present(
        fixture.rightId,
        fixture.rightName,
        fixture.matching.right,
      ),
    };
    const result = rule().evaluate(target);
    if (result.status === "compatible" || result.status === "incompatible") {
      assert.equal(result.status, "compatible");
      assert.deepEqual(result.comparedValue, fixture.matching);
      assert.equal(result.left.candidatePartId, fixture.leftId);
      assert.equal(result.right.candidatePartId, fixture.rightId);
    } else {
      assert.fail("expected a decided status");
    }
  });

  test(`${fixture.ruleId}: 不一致な確認済み値は互換性なしとする`, () => {
    const target: RuleTarget = {
      ruleId: fixture.ruleId,
      left: present(fixture.leftId, fixture.leftName, fixture.mismatching.left),
      right: present(
        fixture.rightId,
        fixture.rightName,
        fixture.mismatching.right,
      ),
    };
    const result = rule().evaluate(target);
    if (result.status === "compatible" || result.status === "incompatible") {
      assert.equal(result.status, "incompatible");
      assert.deepEqual(result.comparedValue, fixture.mismatching);
    } else {
      assert.fail("expected a decided status");
    }
  });

  test(`${fixture.ruleId}: 左側カテゴリ欠如は不足項目付き判定不能とし非互換へ変換しない`, () => {
    const target: RuleTarget = {
      ruleId: fixture.ruleId,
      left: absent,
      right: present(
        fixture.rightId,
        fixture.rightName,
        fixture.matching.right,
      ),
    };
    const result = rule().evaluate(target);
    assert.equal(result.status, "unknown");
    if (result.status === "unknown") {
      assert.deepEqual(result.missingFields, [
        { side: "left", reason: "category-missing" },
      ]);
      assert.equal(result.left, undefined);
    } else {
      assert.fail("expected unknown status");
    }
  });

  test(`${fixture.ruleId}: 右側カテゴリ欠如は不足項目付き判定不能とし非互換へ変換しない`, () => {
    const target: RuleTarget = {
      ruleId: fixture.ruleId,
      left: present(fixture.leftId, fixture.leftName, fixture.matching.left),
      right: absent,
    };
    const result = rule().evaluate(target);
    assert.equal(result.status, "unknown");
    if (result.status === "unknown") {
      assert.deepEqual(result.missingFields, [
        { side: "right", reason: "category-missing" },
      ]);
      assert.equal(result.right, undefined);
    } else {
      assert.fail("expected unknown status");
    }
  });

  test(`${fixture.ruleId}: 左側の未確認値は判定不能とし非互換へ変換しない`, () => {
    const target: RuleTarget = {
      ruleId: fixture.ruleId,
      left: present(fixture.leftId, fixture.leftName),
      right: present(
        fixture.rightId,
        fixture.rightName,
        fixture.matching.right,
      ),
    };
    const result = rule().evaluate(target);
    assert.equal(result.status, "unknown");
    if (result.status === "unknown") {
      assert.deepEqual(result.missingFields, [
        { side: "left", reason: "value-unconfirmed" },
      ]);
    } else {
      assert.fail("expected unknown status");
    }
  });

  test(`${fixture.ruleId}: 右側の未確認値は判定不能とし非互換へ変換しない`, () => {
    const target: RuleTarget = {
      ruleId: fixture.ruleId,
      left: present(fixture.leftId, fixture.leftName, fixture.matching.left),
      right: present(fixture.rightId, fixture.rightName),
    };
    const result = rule().evaluate(target);
    assert.equal(result.status, "unknown");
    if (result.status === "unknown") {
      assert.deepEqual(result.missingFields, [
        { side: "right", reason: "value-unconfirmed" },
      ]);
    } else {
      assert.fail("expected unknown status");
    }
  });

  test(`${fixture.ruleId}: 同じ入力へ繰り返し評価しても同一の個別結果を返す`, () => {
    const target: RuleTarget = {
      ruleId: fixture.ruleId,
      left: present(fixture.leftId, fixture.leftName, fixture.matching.left),
      right: present(
        fixture.rightId,
        fixture.rightName,
        fixture.matching.right,
      ),
    };
    const first = rule().evaluate(target);
    const second = rule().evaluate(target);
    assert.deepEqual(first, second);
  });
}

test("両側カテゴリ欠如でも判定不能とし片方だけの不足に丸めない", () => {
  const target: RuleTarget = {
    ruleId: "case-psu-form-factor",
    left: absent,
    right: absent,
  };
  const result = ruleFor("case-psu-form-factor").evaluate(target);
  assert.equal(result.status, "unknown");
  if (result.status === "unknown") {
    assert.deepEqual(result.missingFields, [
      { side: "left", reason: "category-missing" },
      { side: "right", reason: "category-missing" },
    ]);
    assert.equal(result.left, undefined);
    assert.equal(result.right, undefined);
  } else {
    assert.fail("expected unknown status");
  }
});

test("5規則を異なる実行順序で評価しても各規則の個別結果は変わらない", () => {
  const targets: readonly RuleTarget[] = RULE_FIXTURES.map((fixture) => ({
    ruleId: fixture.ruleId,
    left: present(fixture.leftId, fixture.leftName, fixture.matching.left),
    right: present(fixture.rightId, fixture.rightName, fixture.matching.right),
  }));

  const evaluateAll = (order: readonly RuleTarget[]): readonly RuleResult[] =>
    order.map((target) => ruleFor(target.ruleId).evaluate(target));

  const forward = evaluateAll(targets);
  const reversed = evaluateAll([...targets].reverse());
  const shuffled = evaluateAll([
    targets[2] as RuleTarget,
    targets[0] as RuleTarget,
    targets[4] as RuleTarget,
    targets[1] as RuleTarget,
    targets[3] as RuleTarget,
  ]);

  const byRule = (results: readonly RuleResult[]) =>
    new Map(results.map((result) => [result.ruleId, result]));

  const forwardByRule = byRule(forward);
  for (const [ruleId, result] of byRule(reversed)) {
    assert.deepEqual(result, forwardByRule.get(ruleId));
  }
  for (const [ruleId, result] of byRule(shuffled)) {
    assert.deepEqual(result, forwardByRule.get(ruleId));
  }
  assert.ok(forward.every((result) => result.status === "compatible"));
});
