import type { TransientGestureRegistrationPort } from "../../application-shell/public.js";
import type {
  CandidatePartId,
  CandidateSourceId,
  MoneyValue,
  Result,
  SourcedValue,
  UtcTimestamp,
} from "../../domain/public.js";
import type {
  CandidateSourceCatalogPort,
  CandidateSourceMutationPort,
  ManagementError,
} from "../candidate-management/public.js";
import type {
  PagePriceExtractionError,
  PagePriceExtractionPort,
} from "../product-capture/public.js";

declare const normalizedSourcePageUrlBrand: unique symbol;

/** Conservative comparison key for a stored source page URL. */
export type NormalizedSourcePageUrl = string & {
  readonly [normalizedSourcePageUrlBrand]: "NormalizedSourcePageUrl";
};

export type SourceUrlIdentityError = { readonly kind: "invalid-url" };

/** Whole-catalog matching versus matching inside a single candidate. */
export type SourceMatchScope =
  | { readonly kind: "catalog" }
  | { readonly kind: "candidate"; readonly candidateId: CandidatePartId };

export interface MatchStoredSourceInput {
  readonly scope: SourceMatchScope;
  readonly pageUrl: string;
}

export interface MatchedCandidateSource {
  readonly candidateId: CandidatePartId;
  readonly sourceId: CandidateSourceId;
  readonly normalizedPageUrl: NormalizedSourcePageUrl;
  readonly isPrimary: boolean;
}

export interface RefreshCapturedPriceInput {
  readonly target: Pick<MatchedCandidateSource, "candidateId" | "sourceId">;
  readonly observedPageUrl: string;
  readonly capturedAt: UtcTimestamp;
  readonly price?: SourcedValue<MoneyValue>;
}

export interface SourcePriceRefreshReceipt {
  readonly candidateId: CandidatePartId;
  readonly sourceId: CandidateSourceId;
  readonly price: SourcedValue<MoneyValue>;
  readonly capturedAt: UtcTimestamp;
  readonly isPrimary: boolean;
}

/** Storage failures this feature surfaces without redefining upstream errors. */
export type SourcePriceRefreshStorageError = Extract<
  ManagementError,
  {
    readonly kind:
      | "validation"
      | "conflict"
      | "maintenance"
      | "storage"
      | "quota"
      | "unsupported-data";
  }
>;

export type SourcePriceRefreshError =
  | SourceUrlIdentityError
  | { readonly kind: "no-match" }
  | { readonly kind: "ambiguous-match" }
  | { readonly kind: "ineligible-source" }
  | { readonly kind: "price-unavailable" }
  | { readonly kind: "stale-activation" }
  | { readonly kind: "stale-target" }
  | PagePriceExtractionError
  | SourcePriceRefreshStorageError;

export interface SourcePriceRefreshPort {
  matchSource(
    input: MatchStoredSourceInput,
  ): Promise<Result<MatchedCandidateSource, SourcePriceRefreshError>>;
  refreshCapturedPrice(
    input: RefreshCapturedPriceInput,
  ): Promise<Result<SourcePriceRefreshReceipt, SourcePriceRefreshError>>;
}

export interface SourcePriceRefreshPublicApi {
  readonly refresh: SourcePriceRefreshPort;
}

/**
 * The complete set of upstream dependencies this feature accepts. Every entry
 * is an approved producer-owned port: candidate-management `sources.catalog` /
 * `sources.mutations`, product-capture `pagePriceExtraction`, and the shell's
 * synchronous transient gesture registration.
 */
export interface SourcePriceRefreshUpstreamPorts {
  readonly catalog: CandidateSourceCatalogPort;
  readonly mutations: CandidateSourceMutationPort;
  readonly pagePriceExtraction: PagePriceExtractionPort;
  readonly gestures: TransientGestureRegistrationPort;
}
