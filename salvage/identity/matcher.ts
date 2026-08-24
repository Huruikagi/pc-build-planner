import { err, ok, type Result } from "../domain/public.js";
import type { CandidateSourcePublicError } from "./app-data-error-projection.js";
import type {
  CandidateSourceReference,
  CandidateSourceScope,
  SourceMatchResult,
} from "./model.js";
import { identifyCandidateSourceUrl } from "./url-identity.js";

export interface CandidateSourceReferenceSnapshotPort {
  listSourceReferences(input: {
    readonly scope: CandidateSourceScope;
  }): Promise<
    Result<readonly CandidateSourceReference[], CandidateSourcePublicError>
  >;
}

export interface CandidateSourceMatcherPort {
  matchByPageUrl(input: {
    readonly scope: CandidateSourceScope;
    readonly pageUrl: string;
  }): Promise<Result<SourceMatchResult, CandidateSourcePublicError>>;
}

export const createCandidateSourceMatcher = (
  snapshots: CandidateSourceReferenceSnapshotPort,
): CandidateSourceMatcherPort => ({
  async matchByPageUrl(input) {
    const requestedIdentity = identifyCandidateSourceUrl(input.pageUrl);
    if (!requestedIdentity.ok) return err(requestedIdentity.error);

    const snapshot = await snapshots.listSourceReferences({
      scope: input.scope,
    });
    if (!snapshot.ok) return snapshot;

    const references: CandidateSourceReference[] = [];
    for (const reference of snapshot.value) {
      const storedIdentity = identifyCandidateSourceUrl(reference.pageUrl);
      if (
        storedIdentity.ok &&
        storedIdentity.value === requestedIdentity.value
      ) {
        references.push(reference);
      }
    }

    if (references.length === 0) return ok({ kind: "no-match" });
    if (references.length === 1) {
      const [reference] = references;
      if (reference === undefined) return ok({ kind: "no-match" });
      return ok({ kind: "unique", reference });
    }
    return ok({ kind: "ambiguous-match", references });
  },
});
