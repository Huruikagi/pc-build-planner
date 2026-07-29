import type {
  CandidatePart,
  LocalDataRoot,
  Result,
  Revision,
} from "../../domain/public.js";
import type { FoundationScopedDataPort } from "../../persistence/public.js";
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
    kind: "create" | "update",
  ): Promise<Result<void, CandidateSourceDataError>>;
}

/** Adapts the canonical scoped foundation port without exposing storage internals. */
export const createCandidateSourceDataPort = (
  data: FoundationScopedDataPort,
): CandidateSourceDataPort => ({
  query: (project) => data.query(project),
  async mutateCandidate(candidate, context, kind) {
    const result = await data.mutate({
      requestId: context.requestId,
      expectedRevision: context.expectedRevision as Revision,
      operation: { kind, entity: "candidatePart", value: candidate },
    });
    return result.ok
      ? { ok: true, value: undefined }
      : { ok: false, error: result.error };
  },
});

export const unavailableCandidateSourceDataPort: CandidateSourceDataPort = {
  async query() {
    return { ok: false, error: { code: "unsupported-version" } };
  },
  async mutateCandidate() {
    return { ok: false, error: { code: "unsupported-version" } };
  },
};
