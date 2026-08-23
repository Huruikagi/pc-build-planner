import type {
  CandidatePart,
  CandidatePartId,
  CandidateSource,
  CandidateSourceId,
  CandidateSourceKind,
  CandidateSourceState,
  MoneyValue,
  Result,
  SourcedValue,
  UtcTimestamp,
} from "../domain/public.js";

export type CandidateSourceEntity = CandidateSource;

export interface CandidateSourceEntityInput {
  readonly id: CandidateSourceId;
  readonly pageUrl?: string;
  readonly siteName?: string;
  readonly capturedAt?: UtcTimestamp;
  readonly price?: SourcedValue<MoneyValue>;
  readonly kind?: CandidateSourceKind;
}

export interface CandidateSourceReference {
  readonly candidateId: CandidatePartId;
  readonly sourceId: CandidateSourceId;
  readonly pageUrl?: string;
  readonly kind?: CandidateSourceKind;
  readonly isPrimary: boolean;
}

export type CandidateSourceScope =
  | { readonly kind: "all-candidates" }
  | { readonly kind: "candidate"; readonly candidateId: CandidatePartId };

export type SourceMatchResult =
  | { readonly kind: "no-match" }
  | { readonly kind: "unique"; readonly reference: CandidateSourceReference }
  | {
      readonly kind: "ambiguous-match";
      readonly references: readonly CandidateSourceReference[];
    };

export interface AddCandidateSourceInput {
  readonly candidateId: CandidatePartId;
  readonly source: CandidateSourceEntityInput & { readonly pageUrl: string };
}

export interface UpdateCandidateSourceInput {
  readonly candidateId: CandidatePartId;
  readonly source: CandidateSourceEntityInput;
}

export interface RemoveCandidateSourceInput {
  readonly candidateId: CandidatePartId;
  readonly sourceId: CandidateSourceId;
  readonly replacementPrimarySourceId?: CandidateSourceId;
}

export interface SetPrimarySourceInput {
  readonly candidateId: CandidatePartId;
  readonly sourceId: CandidateSourceId;
}

export interface PatchCandidateSourcePriceInput {
  readonly candidateId: CandidatePartId;
  readonly sourceId: CandidateSourceId;
  readonly expectedPageUrl: string;
  readonly expectedKind: "retail";
  readonly price: SourcedValue<MoneyValue>;
  readonly capturedAt: UtcTimestamp;
}

export type CandidateSourceMutationResult<Error> = Result<CandidatePart, Error>;
export type CandidateSourcePolicyResult = Result<
  CandidateSourceState,
  CandidateSourcePolicyError
>;

export type CandidateSourcePolicyError =
  | { readonly kind: "duplicate-source" }
  | { readonly kind: "source-not-found" }
  | { readonly kind: "replacement-required" }
  | { readonly kind: "invalid-replacement" };

export interface CandidateSourceProjection {
  readonly pageUrl?: string;
  readonly price?: SourcedValue<MoneyValue>;
}
