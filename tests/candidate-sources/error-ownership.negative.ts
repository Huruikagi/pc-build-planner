import * as CandidateSources from "../../src/candidate-sources/public.js";
import type { AppDataError } from "../../src/domain/public.js";
import type * as CandidateManagement from "../../src/features/candidate-management/public.js";

// @ts-expect-error ManagementError is not part of the source core contract.
type ManagementError = CandidateSources.ManagementError;
// @ts-expect-error Candidate management must not alias or re-export the source error owner.
type CandidateOwnedSourceError = CandidateManagement.CandidateSourcePublicError;
// @ts-expect-error FoundationError mapping remains owned by the foundation.
const foundationMapper = CandidateSources.mapFoundationError;

declare const dataError: AppDataError;
declare const unknownError: unknown;

// @ts-expect-error Projection preserves the typed error instead of shrinking to a message.
const messageOnly: string = CandidateSources.projectAppDataError(dataError);
const guessed: CandidateSources.CandidateSourcePublicError =
  // @ts-expect-error Unknown errors are not guessed into a known AppDataError variant.
  CandidateSources.projectAppDataError(unknownError);

void (0 as unknown as ManagementError);
void (0 as unknown as CandidateOwnedSourceError);
void foundationMapper;
void messageOnly;
void guessed;
