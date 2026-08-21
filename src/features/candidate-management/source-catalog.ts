import type { AppDataError, CandidatePart } from "../../domain/public.js";
import type {
  CandidateSourceCatalogPort,
  CandidateSourceReference,
} from "./contracts.js";
import type { CandidateSourceDataPort } from "./source-data-port.js";

export interface CandidateSourceCatalogDependencies {
  readonly data: Pick<CandidateSourceDataPort, "query">;
}

const reference = (
  candidate: CandidatePart,
  source: CandidatePart["sources"][number],
): CandidateSourceReference => ({
  candidateId: candidate.id,
  sourceId: source.id,
  ...(source.pageUrl === undefined ? {} : { pageUrl: source.pageUrl }),
  ...(source.kind === undefined ? {} : { kind: source.kind }),
  isPrimary: candidate.primarySourceId === source.id,
});

/** Read-only projection over the canonical production root. */
export const createCandidateSourceCatalog = (
  dependencies: CandidateSourceCatalogDependencies,
): CandidateSourceCatalogPort => ({
  async listSourceReferences(input) {
    const result = await dependencies.data.query((root) => {
      const candidates =
        input.candidateId === undefined
          ? root.candidateParts
          : root.candidateParts.filter(
              (candidate) => candidate.id === input.candidateId,
            );
      return {
        candidateFound:
          input.candidateId === undefined || candidates.length === 1,
        references: candidates.flatMap((candidate) =>
          candidate.sources.map((source) => reference(candidate, source)),
        ),
      };
    });
    if (!result.ok) return result;
    return result.value.candidateFound
      ? { ok: true, value: result.value.references }
      : {
          ok: false,
          error: {
            code: "validation",
            reason: "entity-not-found",
            message: "candidate",
          } satisfies AppDataError,
        };
  },

  async getSourceReference(input) {
    const result = await dependencies.data.query((root) => {
      const candidate = root.candidateParts.find(
        (item) => item.id === input.candidateId,
      );
      const source = candidate?.sources.find(
        (item) => item.id === input.sourceId,
      );
      return {
        candidateFound: candidate !== undefined,
        value:
          candidate === undefined || source === undefined
            ? undefined
            : reference(candidate, source),
      };
    });
    if (!result.ok) return result;
    if (!result.value.candidateFound)
      return {
        ok: false,
        error: {
          code: "validation",
          reason: "entity-not-found",
          message: "candidate",
        },
      };
    return result.value.value === undefined
      ? {
          ok: false,
          error: {
            code: "validation",
            reason: "entity-not-found",
            message: "source",
          },
        }
      : { ok: true, value: result.value.value };
  },
});
