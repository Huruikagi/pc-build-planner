import type {
  CandidatePartId,
  ProjectId,
  Result,
  UtcTimestamp,
} from "../../domain/public.js";

/** Fixed set of the five basic compatibility rules; no rule DSL or dynamic registration. */
export type RuleId =
  | "cpu-motherboard-socket"
  | "motherboard-memory-ddr"
  | "cooler-cpu-socket"
  | "case-motherboard-form-factor"
  | "case-psu-form-factor";

export const RULE_IDS: readonly RuleId[] = [
  "cpu-motherboard-socket",
  "motherboard-memory-ddr",
  "cooler-cpu-socket",
  "case-motherboard-form-factor",
  "case-psu-form-factor",
] as const;

/** Per-rule individual result status; distinct from the four-way AggregateStatus. */
export type RuleStatus = "compatible" | "incompatible" | "unknown";

/** A confirmed standard value: a single spec (e.g. socket) or a supported set (e.g. supportedSockets). */
export type CompatibilityValue = string | readonly string[];

/** One side of a rule's pair; absent means the category has no selected candidate at all. */
export type RuleTargetParty =
  | {
      readonly kind: "present";
      readonly candidatePartId: CandidatePartId;
      readonly displayName: string;
      /** Undefined when the confirmed attribute itself is unconfirmed. */
      readonly value?: CompatibilityValue;
    }
  | { readonly kind: "absent" };

/** One candidate-pair combination expanded for a given RuleId. */
export interface RuleTarget {
  readonly ruleId: RuleId;
  readonly left: RuleTargetParty;
  readonly right: RuleTargetParty;
}

export interface RuleResultParty {
  readonly candidatePartId: CandidatePartId;
  readonly displayName: string;
}

export interface RuleMissingField {
  readonly side: "left" | "right";
  readonly reason: "category-missing" | "value-unconfirmed";
}

export interface CompatibleRuleResult {
  readonly ruleId: RuleId;
  readonly status: "compatible";
  readonly left: RuleResultParty;
  readonly right: RuleResultParty;
  readonly comparedValue: {
    readonly left: CompatibilityValue;
    readonly right: CompatibilityValue;
  };
  readonly reasonCode: string;
}

export interface IncompatibleRuleResult {
  readonly ruleId: RuleId;
  readonly status: "incompatible";
  readonly left: RuleResultParty;
  readonly right: RuleResultParty;
  readonly comparedValue: {
    readonly left: CompatibilityValue;
    readonly right: CompatibilityValue;
  };
  readonly reasonCode: string;
}

export interface UnknownRuleResult {
  readonly ruleId: RuleId;
  readonly status: "unknown";
  readonly left?: RuleResultParty;
  readonly right?: RuleResultParty;
  readonly missingFields: readonly RuleMissingField[];
  readonly reasonCode: string;
}

/** Individual result for one RuleTarget; a read-only derived value, never persisted. */
export type RuleResult =
  | CompatibleRuleResult
  | IncompatibleRuleResult
  | UnknownRuleResult;

/** Four-way aggregate category; distinct from per-rule RuleStatus. */
export type AggregateStatus =
  | "compatible"
  | "incompatible"
  | "caution"
  | "unknown";

export const AGGREGATE_STATUSES: readonly AggregateStatus[] = [
  "compatible",
  "incompatible",
  "caution",
  "unknown",
] as const;

/** Read-only derived snapshot; no persistence model exists for this shape. */
export interface CompatibilityReport {
  readonly projectId: ProjectId;
  readonly buildUpdatedAt: UtcTimestamp;
  readonly status: AggregateStatus;
  readonly results: readonly RuleResult[];
}

/** Read failures and invalid input, kept distinct from RuleStatus/AggregateStatus values. */
export type CompatibilityError =
  | { readonly kind: "no-build" }
  | { readonly kind: "empty-build" }
  | { readonly kind: "invalid-reference" }
  | { readonly kind: "corrupt-data" }
  | { readonly kind: "unsupported-data" }
  | { readonly kind: "read-failed" };

export interface CompatibilityQuery {
  evaluate(
    projectId: ProjectId,
  ): Promise<Result<CompatibilityReport, CompatibilityError>>;
}
