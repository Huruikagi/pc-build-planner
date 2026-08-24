import type {
  CompatibilityValue,
  RuleId,
  RuleMissingField,
  RuleResult,
  RuleResultParty,
  RuleTarget,
  RuleTargetParty,
} from "./contracts.js";

type ComparisonMode = "equality" | "containment";

interface RuleDefinition {
  readonly id: RuleId;
  readonly mode: ComparisonMode;
}

/** left is always the single-value side; right is single (equality) or a supported set (containment). */
const RULE_DEFINITIONS: readonly RuleDefinition[] = [
  { id: "cpu-motherboard-socket", mode: "equality" },
  { id: "motherboard-memory-ddr", mode: "equality" },
  { id: "cooler-cpu-socket", mode: "containment" },
  { id: "case-motherboard-form-factor", mode: "containment" },
  { id: "case-psu-form-factor", mode: "containment" },
];

const toResultParty = (party: RuleTargetParty): RuleResultParty | undefined =>
  party.kind === "present"
    ? { candidatePartId: party.candidatePartId, displayName: party.displayName }
    : undefined;

const missingFieldFor = (
  side: "left" | "right",
  party: RuleTargetParty,
): RuleMissingField | undefined => {
  if (party.kind === "absent") {
    return { side, reason: "category-missing" };
  }
  if (party.value === undefined) {
    return { side, reason: "value-unconfirmed" };
  }
  return undefined;
};

const valuesMatch = (
  mode: ComparisonMode,
  left: CompatibilityValue,
  right: CompatibilityValue,
): boolean => {
  if (mode === "equality") {
    return typeof left === "string" && left === right;
  }
  return (
    typeof left === "string" && Array.isArray(right) && right.includes(left)
  );
};

const evaluateRule = (
  ruleId: RuleId,
  mode: ComparisonMode,
  target: RuleTarget,
): RuleResult => {
  const missingFields: RuleMissingField[] = [];
  const leftMissing = missingFieldFor("left", target.left);
  const rightMissing = missingFieldFor("right", target.right);
  if (leftMissing !== undefined) {
    missingFields.push(leftMissing);
  }
  if (rightMissing !== undefined) {
    missingFields.push(rightMissing);
  }

  if (missingFields.length > 0) {
    const left = toResultParty(target.left);
    const right = toResultParty(target.right);
    return {
      ruleId,
      status: "unknown",
      ...(left !== undefined ? { left } : {}),
      ...(right !== undefined ? { right } : {}),
      missingFields,
      reasonCode: "input-missing",
    };
  }

  const leftParty = target.left as Extract<
    RuleTargetParty,
    { kind: "present" }
  >;
  const rightParty = target.right as Extract<
    RuleTargetParty,
    { kind: "present" }
  >;
  const leftValue = leftParty.value as CompatibilityValue;
  const rightValue = rightParty.value as CompatibilityValue;
  const matches = valuesMatch(mode, leftValue, rightValue);

  return {
    ruleId,
    status: matches ? "compatible" : "incompatible",
    left: {
      candidatePartId: leftParty.candidatePartId,
      displayName: leftParty.displayName,
    },
    right: {
      candidatePartId: rightParty.candidatePartId,
      displayName: rightParty.displayName,
    },
    comparedValue: { left: leftValue, right: rightValue },
    reasonCode:
      mode === "equality"
        ? matches
          ? "value-equal"
          : "value-not-equal"
        : matches
          ? "value-included"
          : "value-not-included",
  };
};

export interface CompatibilityRule {
  readonly id: RuleId;
  evaluate(target: RuleTarget): RuleResult;
}

/** Fixed registry of the five basic compatibility rules; no DSL, no dynamic registration. */
export const RULE_REGISTRY: readonly CompatibilityRule[] = RULE_DEFINITIONS.map(
  (definition) => ({
    id: definition.id,
    evaluate: (target: RuleTarget) =>
      evaluateRule(definition.id, definition.mode, target),
  }),
);
