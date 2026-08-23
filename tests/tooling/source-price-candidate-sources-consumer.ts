import type {
  CandidateSourceMatcherPort,
  CandidateSourceScope,
  PatchCandidateSourcePriceInput,
  SourcePricePatchContract,
} from "../../src/candidate-sources/public.js";
import type { AppDataError } from "../../src/domain/public.js";

export type SourcePriceAppDataErrorKind =
  | "validation"
  | "conflict"
  | "maintenance"
  | "storage"
  | "quota"
  | "unsupported-data";

export const classifySourcePriceAppDataError = (
  error: AppDataError,
): SourcePriceAppDataErrorKind => {
  switch (error.code) {
    case "validation":
      return "validation";
    case "revision-conflict":
    case "request-conflict":
    case "stale-recovery-state":
    case "stale-fence":
    case "stale-assessment":
      return "conflict";
    case "maintenance-active":
    case "recovery-active":
    case "precommit-cleanup-pending":
      return "maintenance";
    case "quota-exceeded":
      return "quota";
    case "access-denied":
    case "lock-unavailable":
    case "storage-unavailable":
      return "storage";
    case "corrupt-data":
    case "unsupported-version":
    case "migration-failed":
    case "repair-failed":
      return "unsupported-data";
    default:
      return error satisfies never;
  }
};

export interface MatchedRetailPriceObservation {
  readonly pageUrl: string;
  readonly price: PatchCandidateSourcePriceInput["price"];
  readonly capturedAt: PatchCandidateSourcePriceInput["capturedAt"];
}

export const refreshMatchedRetailSource = async (
  matcher: CandidateSourceMatcherPort,
  patches: SourcePricePatchContract,
  scope: CandidateSourceScope,
  observation: MatchedRetailPriceObservation,
) => {
  const match = await matcher.matchByPageUrl({
    scope,
    pageUrl: observation.pageUrl,
  });
  if (!match.ok || match.value.kind !== "unique") return match;
  const { reference } = match.value;
  if (reference.kind !== "retail") return match;
  return patches.patchSourcePrice({
    candidateId: reference.candidateId,
    sourceId: reference.sourceId,
    expectedPageUrl: reference.pageUrl ?? observation.pageUrl,
    expectedKind: "retail",
    price: observation.price,
    capturedAt: observation.capturedAt,
  });
};

export const patchMatchedRetailSource = async (
  matcher: CandidateSourceMatcherPort,
  patches: SourcePricePatchContract,
  scope: CandidateSourceScope,
  input: Omit<PatchCandidateSourcePriceInput, "candidateId" | "sourceId">,
) => {
  return refreshMatchedRetailSource(matcher, patches, scope, {
    pageUrl: input.expectedPageUrl,
    price: input.price,
    capturedAt: input.capturedAt,
  });
};
