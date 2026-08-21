import {
  type CandidatePart,
  type CandidatePartId,
  type CandidateSourceId,
  type CandidateSourceState,
  createUtcTimestamp,
  createUuid,
  type Result,
  type UtcTimestamp,
  validateCandidatePartContent,
  validateCandidatePartValue,
} from "../../domain/public.js";
import type {
  FoundationScopedDataPort,
  RootMutationCommand,
} from "../../persistence/public.js";
import type {
  CandidateDraft,
  CandidateManagementQuery,
  CandidateManagementService,
  CandidateOperationError,
  CandidateSourceMutationError,
  CandidateSourceService,
  CandidateSummary,
  MutationContext,
  PatchCandidateSourcePriceInput,
  UpdateCandidateInput,
} from "./contracts.js";
import { candidateSourcePolicy } from "./source-collection.js";
import type { CandidateSourceDataPort } from "./source-data-port.js";
import {
  resolveSourceKind,
  type SourceKindClassifier,
} from "./source-kind-classifier.js";

export interface CandidateManagementServiceDependencies {
  readonly data: FoundationScopedDataPort;
  readonly now?: () => UtcTimestamp;
  readonly createCandidateId?: () => CandidatePartId;
  readonly classifier?: SourceKindClassifier;
  readonly sourceData?: CandidateSourceDataPort;
}

const hasProductName = (draft: CandidateDraft): boolean => {
  const name = draft.product?.name;
  return (
    (typeof name?.original === "string" && name.original.trim().length > 0) ||
    (typeof name?.confirmed === "string" && name.confirmed.trim().length > 0)
  );
};

/** Maps a canonical validation path onto a draft-relative field key for the UI. */
export const draftFieldKey = (path: string): string =>
  path.replace(/^\$\.?/, "") || "product.name";

const validationFailure = (
  path: string,
  code: string,
): CandidateOperationError => ({
  kind: "candidate-validation",
  fields: { [draftFieldKey(path)]: code },
});

const candidateValidation = (
  draft: CandidateDraft,
): Result<CandidateDraft, CandidateOperationError> => {
  if (!hasProductName(draft))
    return {
      ok: false,
      error: {
        kind: "candidate-validation",
        fields: { "product.name": "required" },
      },
    };
  const content = validateCandidatePartContent({
    ...draft,
    sources: draft.sources ?? [],
  });
  if (!content.ok)
    return {
      ok: false,
      error: validationFailure(content.error.path, content.error.code),
    };
  return { ok: true, value: draft };
};

const draftFromCandidate = (candidate: CandidatePart): CandidateDraft =>
  ({
    projectId: candidate.projectId,
    category: candidate.category,
    product: candidate.product,
    normalizedAttributes: candidate.normalizedAttributes,
    sources: candidate.sources,
    ...(candidate.primarySourceId === undefined
      ? {}
      : { primarySourceId: candidate.primarySourceId }),
    ...(candidate.sourceSnapshot === undefined
      ? {}
      : { sourceSnapshot: candidate.sourceSnapshot }),
  }) as CandidateDraft;

const commandFor = (
  operation: RootMutationCommand["operation"],
  context: MutationContext,
): RootMutationCommand => ({
  requestId: context.requestId,
  expectedRevision:
    context.expectedRevision as RootMutationCommand["expectedRevision"],
  operation,
});

const candidateSummary = (candidate: CandidatePart): CandidateSummary => {
  const { name, manufacturer, modelNumber } = candidate.product;
  const primarySource = candidate.sources.find(
    (source) => source.id === candidate.primarySourceId,
  );
  const representativePrice = primarySource?.price;
  return {
    id: candidate.id,
    projectId: candidate.projectId,
    category: candidate.category,
    ...(name === undefined ? {} : { name }),
    ...(primarySource === undefined ? {} : { primarySource }),
    ...(representativePrice === undefined
      ? {}
      : { price: representativePrice }),
    ...(manufacturer === undefined ? {} : { manufacturer }),
    ...(modelNumber === undefined ? {} : { modelNumber }),
    hasMissingDetails:
      name === undefined ||
      representativePrice === undefined ||
      manufacturer === undefined ||
      modelNumber === undefined,
    updatedAt: candidate.updatedAt,
  };
};

export const createCandidateManagementService = (
  dependencies: CandidateManagementServiceDependencies,
): CandidateManagementService &
  CandidateManagementQuery &
  CandidateSourceService => {
  const now = dependencies.now ?? createUtcTimestamp;
  const newCandidateId =
    dependencies.createCandidateId ?? (() => createUuid() as CandidatePartId);
  const classifier: SourceKindClassifier = dependencies.classifier ?? {
    classify: () => "retail",
  };
  const classifySource = (source: CandidatePart["sources"][number]) =>
    source.pageUrl === undefined
      ? source
      : {
          ...source,
          kind: resolveSourceKind(source.pageUrl, source.kind, classifier),
        };
  const sourceData = dependencies.sourceData;

  const sourceValidation = (candidate: CandidatePart) => {
    const checked = validateCandidatePartValue(candidate);
    return checked.ok
      ? ({ ok: true, value: candidate } as const)
      : ({
          ok: false,
          error: validationFailure(checked.error.path, checked.error.code),
        } as const);
  };

  const mutateSource = async <ChangeError extends CandidateSourceMutationError>(
    candidateId: CandidatePartId,
    context: MutationContext,
    change: (
      candidate: CandidatePart,
    ) => Result<
      Pick<CandidatePart, "sources" | "primarySourceId">,
      ChangeError
    >,
  ): Promise<Result<CandidatePart, CandidateOperationError | ChangeError>> => {
    if (sourceData === undefined)
      return { ok: false, error: { code: "storage-unavailable" } };
    const existing = await sourceData.query((snapshot) =>
      snapshot.candidateParts.find((candidate) => candidate.id === candidateId),
    );
    if (!existing.ok) return existing;
    if (existing.value === undefined)
      return {
        ok: false,
        error: {
          code: "validation",
          reason: "entity-not-found",
          message: "candidate",
        },
      };
    const candidate = existing.value;
    const changed = change(candidate);
    if (!changed.ok) return changed;
    const {
      sources: _sources,
      primarySourceId: _primary,
      ...candidateBase
    } = candidate;
    const updated = {
      ...candidateBase,
      ...changed.value,
      updatedAt: now(),
    } as CandidatePart;
    const validated = sourceValidation(updated);
    if (!validated.ok) return validated;
    const mutation = await sourceData.mutateCandidate(
      updated,
      context,
      "update",
    );
    return mutation.ok
      ? { ok: true, value: updated }
      : {
          ok: false,
          error: mutation.error,
        };
  };

  const patchSourcePrice = async (
    input: PatchCandidateSourcePriceInput,
    context: MutationContext,
  ): Promise<Result<CandidatePart, CandidateSourceMutationError>> =>
    mutateSource(input.candidateId, context, (candidate) => {
      const index = candidate.sources.findIndex(
        (source) => source.id === input.sourceId,
      );
      if (index < 0)
        return { ok: false, error: { kind: "precondition-failed" } };
      const current = candidate.sources[index];
      if (
        current?.pageUrl !== input.expectedPageUrl ||
        current.kind !== input.expectedKind
      )
        return { ok: false, error: { kind: "precondition-failed" } };
      return {
        ok: true,
        value: {
          sources: candidate.sources.map((source, sourceIndex) =>
            sourceIndex === index
              ? {
                  ...source,
                  price: input.price,
                  capturedAt: input.capturedAt,
                }
              : source,
          ) as unknown as CandidatePart["sources"],
          primarySourceId: candidate.primarySourceId,
        } as Pick<CandidatePart, "sources" | "primarySourceId">,
      };
    });

  const ruleFailure = (kind: string): CandidateOperationError =>
    kind === "source-not-found"
      ? { code: "validation", reason: "entity-not-found", message: "source" }
      : { kind: "candidate-validation", fields: { sources: kind } };

  const sourceStateOf = (candidate: CandidatePart): CandidateSourceState =>
    candidate.sources.length === 0
      ? { sources: [] }
      : {
          sources: candidate.sources as [
            CandidatePart["sources"][number],
            ...CandidatePart["sources"][number][],
          ],
          primarySourceId: candidate.primarySourceId as NonNullable<
            CandidatePart["primarySourceId"]
          >,
        };

  const mutateCandidate = async (
    candidate: CandidatePart,
    kind: "create" | "update",
    context: MutationContext,
  ): Promise<Result<CandidatePart, CandidateOperationError>> => {
    const mutation = await dependencies.data.mutate(
      commandFor({ kind, entity: "candidatePart", value: candidate }, context),
    );
    return mutation.ok
      ? { ok: true, value: candidate }
      : { ok: false, error: mutation.error };
  };

  return {
    async addSource(input, context) {
      let parsed: URL;
      try {
        parsed = new URL(input.source.pageUrl);
      } catch {
        return {
          ok: false,
          error: {
            kind: "candidate-validation",
            fields: { "source.pageUrl": "invalid-url" },
          },
        };
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
        return {
          ok: false,
          error: {
            kind: "candidate-validation",
            fields: { "source.pageUrl": "invalid-url" },
          },
        };
      return mutateSource(input.candidateId, context, (candidate) => {
        const source = {
          ...input.source,
          kind: resolveSourceKind(
            input.source.pageUrl,
            input.source.kind,
            classifier,
          ),
        };
        const result = candidateSourcePolicy.add(
          sourceStateOf(candidate),
          source,
        );
        return result.ok
          ? result
          : { ok: false, error: ruleFailure(result.error.kind) };
      });
    },
    async updateSource(input, context) {
      return mutateSource(input.candidateId, context, (candidate) => {
        const result = candidateSourcePolicy.update(
          sourceStateOf(candidate),
          input.source,
        );
        return result.ok
          ? result
          : { ok: false, error: ruleFailure(result.error.kind) };
      });
    },
    patchSourcePrice,
    async removeSource(input, context) {
      return mutateSource(input.candidateId, context, (candidate) => {
        const result = candidateSourcePolicy.remove(
          sourceStateOf(candidate),
          input.sourceId,
          input.replacementPrimarySourceId,
        );
        return result.ok
          ? result
          : { ok: false, error: ruleFailure(result.error.kind) };
      });
    },
    async setPrimarySource(input, context) {
      return mutateSource(input.candidateId, context, (candidate) => {
        const result = candidateSourcePolicy.setPrimary(
          sourceStateOf(candidate),
          input.sourceId,
        );
        return result.ok
          ? result
          : { ok: false, error: ruleFailure(result.error.kind) };
      });
    },
    async createCandidate(input: CandidateDraft, context: MutationContext) {
      const validated = candidateValidation(input);
      if (!validated.ok) return validated;
      const createdAt = now();
      const [firstSource, ...remainingSources] = input.sources ?? [];
      const primarySourceId = input.primarySourceId;
      const sourceState: CandidateSourceState =
        firstSource === undefined
          ? { sources: [] }
          : primarySourceId === undefined
            ? { sources: [] }
            : {
                sources: [
                  classifySource(firstSource),
                  ...remainingSources.map(classifySource),
                ],
                primarySourceId,
              };
      const candidateBase = {
        id: newCandidateId(),
        projectId: input.projectId,
        category: input.category,
        product: input.product,
        ...(input.sourceSnapshot === undefined
          ? {}
          : { sourceSnapshot: input.sourceSnapshot }),
        normalizedAttributes: input.normalizedAttributes,
        createdAt,
        updatedAt: createdAt,
      };
      const candidate: CandidatePart = { ...candidateBase, ...sourceState };
      if (sourceData !== undefined) {
        const mutation = await sourceData.mutateCandidate(
          candidate,
          context,
          "create",
        );
        return mutation.ok
          ? { ok: true, value: candidate }
          : {
              ok: false,
              error: mutation.error,
            };
      }
      return mutateCandidate(candidate, "create", context);
    },
    async updateCandidate(
      input: UpdateCandidateInput,
      context: MutationContext,
    ) {
      const validated = candidateValidation(input.draft);
      if (!validated.ok) return validated;
      const existing = await dependencies.data.query((root) =>
        root.candidateParts.find((candidate) => candidate.id === input.id),
      );
      if (!existing.ok) return existing;
      if (existing.value === undefined)
        return {
          ok: false,
          error: {
            code: "validation",
            reason: "entity-not-found",
            message: "candidate",
          },
        };
      /**
       * A category change must not drop the shared fields, but it must not
       * discard edits confirmed in the same submission either: the draft is the
       * intended state, so omitted metadata falls back to the stored value.
       * An update never reparents a candidate.
       */
      const {
        primarySourceId: _primarySourceId,
        sources: _sources,
        sourceSnapshot: _sourceSnapshot,
        ...draftBase
      } = input.draft;
      const existingSourceIds = new Set(
        existing.value.sources.map((source) => source.id),
      );
      const sourceState: CandidateSourceState =
        input.draft.sources === undefined
          ? sourceStateOf(existing.value)
          : input.draft.sources.length === 0
            ? { sources: [] }
            : {
                sources: input.draft.sources.map((source) =>
                  existingSourceIds.has(source.id)
                    ? source
                    : classifySource(source),
                ) as unknown as readonly [
                  CandidatePart["sources"][number],
                  ...CandidatePart["sources"][number][],
                ],
                primarySourceId: input.draft
                  .primarySourceId as CandidateSourceId,
              };
      const updated: CandidatePart = {
        id: existing.value.id,
        ...draftBase,
        projectId: existing.value.projectId,
        ...sourceState,
        ...(input.draft.sourceSnapshot === undefined
          ? existing.value.sourceSnapshot === undefined
            ? {}
            : { sourceSnapshot: existing.value.sourceSnapshot }
          : { sourceSnapshot: input.draft.sourceSnapshot }),
        createdAt: existing.value.createdAt,
        updatedAt: now(),
      };
      return mutateCandidate(updated, "update", context);
    },
    async deleteCandidate(id: CandidatePartId, context: MutationContext) {
      const mutation = await dependencies.data.mutate(
        commandFor({ kind: "delete", entity: "candidatePart", id }, context),
      );
      return mutation.ok
        ? { ok: true, value: undefined }
        : {
            ok: false,
            error: mutation.error,
          };
    },
    async listProjects() {
      const result = await dependencies.data.query((root) =>
        root.projects.map(({ id, name, updatedAt }) => ({
          id,
          name,
          updatedAt,
        })),
      );
      return result.ok ? result : result;
    },
    async listCandidates(input) {
      const data = sourceData ?? dependencies.data;
      const result = await data.query((root) =>
        root.candidateParts
          .filter(
            (candidate) =>
              candidate.projectId === input.projectId &&
              (input.category === undefined ||
                candidate.category === input.category),
          )
          .map(candidateSummary),
      );
      return result.ok ? result : result;
    },
    async getCandidateDraft(id) {
      const result = await dependencies.data.query((root) =>
        root.candidateParts.find((candidate) => candidate.id === id),
      );
      if (!result.ok) return result;
      return result.value === undefined
        ? {
            ok: false,
            error: {
              code: "validation",
              reason: "entity-not-found",
              message: "candidate",
            },
          }
        : { ok: true, value: draftFromCandidate(result.value) };
    },
    async listBuildEligible(projectId) {
      const result = await dependencies.data.query((root) =>
        root.candidateParts.filter(
          (candidate) =>
            candidate.projectId === projectId &&
            candidate.category !== "uncategorized",
        ),
      );
      return result.ok ? result : result;
    },
  };
};
