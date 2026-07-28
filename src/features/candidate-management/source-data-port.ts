import type {
  CandidatePartV2,
  LocalDataRootV2,
  Result,
} from "../../domain/public.js";
import type { MutationContext } from "./contracts.js";

export interface CandidateSourceDataError {
  readonly code: string;
}

/** Versioned seam kept separate from the schema-1 production foundation until cutover. */
export interface CandidateSourceDataPort {
  query<T>(
    project: (snapshot: LocalDataRootV2) => T,
  ): Promise<Result<T, CandidateSourceDataError>>;
  mutateCandidate(
    candidate: CandidatePartV2,
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
