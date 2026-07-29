import type {
  CandidatePart,
  LocalDataRoot,
  Result,
} from "../../domain/public.js";
import type { MutationContext } from "./contracts.js";

export interface CandidateSourceDataError {
  readonly code: string;
}

/** Canonical candidate source seam over the production foundation. */
export interface CandidateSourceDataPort {
  query<T>(
    project: (snapshot: LocalDataRoot) => T,
  ): Promise<Result<T, CandidateSourceDataError>>;
  mutateCandidate(
    candidate: CandidatePart,
    context: MutationContext,
  ): Promise<Result<void, CandidateSourceDataError>>;
}

export const unavailableCandidateSourceDataPort: CandidateSourceDataPort = {
  async query() {
    return { ok: false, error: { code: "unsupported-version" } };
  },
  async mutateCandidate() {
    return { ok: false, error: { code: "unsupported-version" } };
  },
};
