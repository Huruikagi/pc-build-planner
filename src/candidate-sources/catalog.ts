import type {
  AppDataError,
  CandidatePart,
  CandidatePartId,
  CandidateSourceId,
  LocalDataRoot,
  Result,
} from "../domain/public.js";
import {
  type CandidateSourcePublicError,
  projectAppDataError,
} from "./app-data-error-projection.js";
import type {
  CandidateSourceReference,
  CandidateSourceScope,
} from "./model.js";

export interface CandidateSourceCatalogSnapshotPort {
  query<T>(
    project: (snapshot: LocalDataRoot) => T,
  ): Promise<Result<T, AppDataError>>;
}

export interface CandidateSourceCatalogPort {
  listSourceReferences(input: {
    readonly scope: CandidateSourceScope;
  }): Promise<
    Result<readonly CandidateSourceReference[], CandidateSourcePublicError>
  >;
  getSourceReference(input: {
    readonly candidateId: CandidatePartId;
    readonly sourceId: CandidateSourceId;
  }): Promise<Result<CandidateSourceReference, CandidateSourcePublicError>>;
}

export interface CandidateSourceCatalogDependencies {
  readonly data: CandidateSourceCatalogSnapshotPort;
}

const toReference = (
  candidate: CandidatePart,
  source: CandidatePart["sources"][number],
): CandidateSourceReference => ({
  candidateId: candidate.id,
  sourceId: source.id,
  ...(source.pageUrl === undefined ? {} : { pageUrl: source.pageUrl }),
  ...(source.kind === undefined ? {} : { kind: source.kind }),
  isPrimary: candidate.primarySourceId === source.id,
});

export const createCandidateSourceCatalog = (
  dependencies: CandidateSourceCatalogDependencies,
): CandidateSourceCatalogPort => ({
  async listSourceReferences({ scope }) {
    const result = await dependencies.data.query((snapshot) => {
      const candidates =
        scope.kind === "all-candidates"
          ? snapshot.candidateParts
          : snapshot.candidateParts.filter(
              (candidate) => candidate.id === scope.candidateId,
            );
      return {
        candidateFound:
          scope.kind === "all-candidates" || candidates.length > 0,
        references: candidates.flatMap((candidate) =>
          candidate.sources.map((source) => toReference(candidate, source)),
        ),
      };
    });
    if (!result.ok) {
      return { ok: false, error: projectAppDataError(result.error) };
    }
    if (!result.value.candidateFound) {
      return {
        ok: false,
        error: { kind: "not-found", entity: "candidate" },
      };
    }
    return { ok: true, value: result.value.references };
  },

  async getSourceReference(input) {
    const result = await dependencies.data.query((snapshot) => {
      const candidate = snapshot.candidateParts.find(
        (item) => item.id === input.candidateId,
      );
      const source = candidate?.sources.find(
        (item) => item.id === input.sourceId,
      );
      return {
        candidateFound: candidate !== undefined,
        reference:
          candidate === undefined || source === undefined
            ? undefined
            : toReference(candidate, source),
      };
    });
    if (!result.ok) {
      return { ok: false, error: projectAppDataError(result.error) };
    }
    if (!result.value.candidateFound) {
      return {
        ok: false,
        error: { kind: "not-found", entity: "candidate" },
      };
    }
    if (result.value.reference === undefined) {
      return {
        ok: false,
        error: { kind: "not-found", entity: "source" },
      };
    }
    return { ok: true, value: result.value.reference };
  },
});
