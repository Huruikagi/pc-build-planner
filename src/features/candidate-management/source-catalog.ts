import type { CandidatePartV2 } from "../../domain/public.js";
import type {
  CandidateSourceCatalogPort,
  CandidateSourceReference,
  ManagementError,
} from "./contracts.js";
import type { CandidateSourceDataPort } from "./source-data-port.js";

export interface CandidateSourceCatalogDependencies {
  readonly data: Pick<CandidateSourceDataPort, "query">;
}

const readError = (code: string): ManagementError => {
  switch (code) {
    case "maintenance-active":
    case "stale-fence":
      return { kind: "maintenance" };
    case "corrupt-data":
    case "unsupported-version":
    case "migration-failed":
      return { kind: "unsupported-data" };
    default:
      return { kind: "storage" };
  }
};

const reference = (
  candidate: CandidatePartV2,
  source: CandidatePartV2["sources"][number],
): CandidateSourceReference => ({
  candidateId: candidate.id,
  sourceId: source.id,
  ...(source.pageUrl === undefined ? {} : { pageUrl: source.pageUrl }),
  ...(source.kind === undefined ? {} : { kind: source.kind }),
  isPrimary: candidate.primarySourceId === source.id,
});

/** Read-only schema-2 projection; production root cutover is composed separately. */
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
    if (!result.ok) return { ok: false, error: readError(result.error.code) };
    return result.value.candidateFound
      ? { ok: true, value: result.value.references }
      : { ok: false, error: { kind: "not-found", entity: "candidate" } };
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
    if (!result.ok) return { ok: false, error: readError(result.error.code) };
    if (!result.value.candidateFound)
      return { ok: false, error: { kind: "not-found", entity: "candidate" } };
    return result.value.value === undefined
      ? { ok: false, error: { kind: "not-found", entity: "source" } }
      : { ok: true, value: result.value.value };
  },
});
