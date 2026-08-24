import {
  type CandidatePart,
  type CurrentBuild,
  err,
  type NormalizedAttributes,
  ok,
  type PartCategory,
  type Result,
} from "../../domain/public.js";
import type { CurrentBuildSnapshot } from "../current-build/public.js";
import type {
  CompatibilityError,
  CompatibilityValue,
  RuleId,
  RuleTarget,
  RuleTargetParty,
} from "./contracts.js";

type AttributeAccessor = (
  attrs: NormalizedAttributes,
) => CompatibilityValue | undefined;

const cpuSocket: AttributeAccessor = (attrs) =>
  attrs.category === "cpu" ? attrs.socket?.confirmed : undefined;

const motherboardSocket: AttributeAccessor = (attrs) =>
  attrs.category === "motherboard" ? attrs.socket?.confirmed : undefined;

const motherboardMemoryStandard: AttributeAccessor = (attrs) =>
  attrs.category === "motherboard"
    ? attrs.memoryStandard?.confirmed
    : undefined;

const memoryStandard: AttributeAccessor = (attrs) =>
  attrs.category === "memory" ? attrs.memoryStandard?.confirmed : undefined;

const coolerSupportedSockets: AttributeAccessor = (attrs) =>
  attrs.category === "cpu-cooler"
    ? attrs.supportedSockets?.confirmed
    : undefined;

const motherboardFormFactor: AttributeAccessor = (attrs) =>
  attrs.category === "motherboard" ? attrs.formFactor?.confirmed : undefined;

const caseSupportedMotherboardFormFactors: AttributeAccessor = (attrs) =>
  attrs.category === "case"
    ? attrs.supportedMotherboardFormFactors?.confirmed
    : undefined;

const psuFormFactor: AttributeAccessor = (attrs) =>
  attrs.category === "power-supply" ? attrs.formFactor?.confirmed : undefined;

const caseSupportedPsuFormFactors: AttributeAccessor = (attrs) =>
  attrs.category === "case"
    ? attrs.supportedPowerSupplyFormFactors?.confirmed
    : undefined;

interface RuleExpansionConfig {
  readonly ruleId: RuleId;
  readonly leftCategory: PartCategory;
  readonly rightCategory: PartCategory;
  readonly leftValue: AttributeAccessor;
  readonly rightValue: AttributeAccessor;
}

/** left is always the single-value side; right is single or a supported set, matching rules.ts. */
const RULE_EXPANSIONS: readonly RuleExpansionConfig[] = [
  {
    ruleId: "cpu-motherboard-socket",
    leftCategory: "cpu",
    rightCategory: "motherboard",
    leftValue: cpuSocket,
    rightValue: motherboardSocket,
  },
  {
    ruleId: "motherboard-memory-ddr",
    leftCategory: "motherboard",
    rightCategory: "memory",
    leftValue: motherboardMemoryStandard,
    rightValue: memoryStandard,
  },
  {
    ruleId: "cooler-cpu-socket",
    leftCategory: "cpu",
    rightCategory: "cpu-cooler",
    leftValue: cpuSocket,
    rightValue: coolerSupportedSockets,
  },
  {
    ruleId: "case-motherboard-form-factor",
    leftCategory: "motherboard",
    rightCategory: "case",
    leftValue: motherboardFormFactor,
    rightValue: caseSupportedMotherboardFormFactors,
  },
  {
    ruleId: "case-psu-form-factor",
    leftCategory: "power-supply",
    rightCategory: "case",
    leftValue: psuFormFactor,
    rightValue: caseSupportedPsuFormFactors,
  },
];

const displayNameOf = (part: CandidatePart): string =>
  part.product.name?.confirmed ?? part.product.name?.original ?? part.id;

const toParty = (
  part: CandidatePart,
  accessor: AttributeAccessor,
): RuleTargetParty => {
  const value = accessor(part.normalizedAttributes);
  return value === undefined
    ? {
        kind: "present",
        candidatePartId: part.id,
        displayName: displayNameOf(part),
      }
    : {
        kind: "present",
        candidatePartId: part.id,
        displayName: displayNameOf(part),
        value,
      };
};

const ABSENT: RuleTargetParty = { kind: "absent" };

const invalidReference: CompatibilityError = { kind: "invalid-reference" };

const resolveSelectedParts = (
  build: CurrentBuild,
  parts: readonly CandidatePart[],
): Result<readonly CandidatePart[], CompatibilityError> => {
  const partsById = new Map(parts.map((part) => [part.id, part]));
  const selected: CandidatePart[] = [];
  for (const item of build.items) {
    const part = partsById.get(item.candidatePartId);
    if (part === undefined) {
      return err(invalidReference);
    }
    if (part.projectId !== build.projectId) {
      return err(invalidReference);
    }
    if (part.category === "uncategorized") {
      return err(invalidReference);
    }
    selected.push(part);
  }
  return ok(selected);
};

const expandRule = (
  config: RuleExpansionConfig,
  selected: readonly CandidatePart[],
): readonly RuleTarget[] => {
  const leftParts = selected.filter(
    (part) => part.category === config.leftCategory,
  );
  const rightParts = selected.filter(
    (part) => part.category === config.rightCategory,
  );

  if (leftParts.length === 0 || rightParts.length === 0) {
    const left = leftParts[0];
    const right = rightParts[0];
    return [
      {
        ruleId: config.ruleId,
        left: left !== undefined ? toParty(left, config.leftValue) : ABSENT,
        right: right !== undefined ? toParty(right, config.rightValue) : ABSENT,
      },
    ];
  }

  const targets: RuleTarget[] = [];
  for (const leftPart of leftParts) {
    for (const rightPart of rightParts) {
      targets.push({
        ruleId: config.ruleId,
        left: toParty(leftPart, config.leftValue),
        right: toParty(rightPart, config.rightValue),
      });
    }
  }
  return targets;
};

export interface TargetExpander {
  expand(
    build: CurrentBuildSnapshot,
    parts: readonly CandidatePart[],
  ): Result<readonly RuleTarget[], CompatibilityError>;
}

export const targetExpander: TargetExpander = {
  expand(build, parts) {
    const currentBuild = build.currentBuild;
    if (currentBuild === null) {
      return err({ kind: "no-build" });
    }

    const selectedResult = resolveSelectedParts(currentBuild, parts);
    if (!selectedResult.ok) {
      return selectedResult;
    }

    const targets = RULE_EXPANSIONS.flatMap((config) =>
      expandRule(config, selectedResult.value),
    );
    return ok(targets);
  },
};
