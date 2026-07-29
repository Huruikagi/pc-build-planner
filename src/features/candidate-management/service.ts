import {
  type CandidatePart,
  type CandidatePartId,
  type CandidatePartV2,
  type CandidateSourceState,
  createUtcTimestamp,
  createUuid,
  type Project,
  type ProjectId,
  type Result,
  type SourceInfo,
  type SourceSnapshot,
  type UtcTimestamp,
  validateCandidatePartContent,
  validateCandidatePartV2Value,
} from "../../domain/public.js";
import type {
  FoundationScopedDataPort,
  RootMutationCommand,
} from "../../persistence/public.js";
import type {
  CandidateDraft,
  CandidateManagementQuery,
  CandidateManagementService,
  CandidateSourceService,
  CandidateSummary,
  CreateProjectInput,
  LegacyUpdateCandidateInput,
  ManagementError,
  MutationContext,
  RenameProjectInput,
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
  readonly createProjectId?: () => ProjectId;
  readonly createCandidateId?: () => CandidatePartId;
  readonly classifier?: SourceKindClassifier;
  readonly sourceData?: CandidateSourceDataPort;
}

const normalizeName = (name: string): Result<string, ManagementError> => {
  const normalized = name.trim();
  return normalized.length === 0
    ? { ok: false, error: { kind: "validation", fields: { name: "required" } } }
    : { ok: true, value: normalized };
};

const managementError = (
  code: string,
  entity?: "project" | "candidate",
): ManagementError => {
  switch (code) {
    case "entity-not-found":
      return entity === undefined
        ? { kind: "validation", fields: {} }
        : { kind: "not-found", entity };
    case "revision-conflict":
    case "request-conflict":
      return { kind: "conflict" };
    case "maintenance-active":
    case "stale-fence":
      return { kind: "maintenance" };
    case "quota-exceeded":
      return { kind: "quota" };
    case "corrupt-data":
    case "unsupported-version":
    case "migration-failed":
      return { kind: "unsupported-data" };
    case "access-denied":
    case "lock-unavailable":
    case "storage-unavailable":
      return { kind: "storage" };
    default:
      return { kind: "validation", fields: {} };
  }
};

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

const validationFailure = (path: string, code: string): ManagementError => ({
  kind: "validation",
  fields: { [draftFieldKey(path)]: code },
});

const candidateValidation = (
  draft: CandidateDraft,
): Result<CandidateDraft, ManagementError> => {
  if (!hasProductName(draft))
    return {
      ok: false,
      error: { kind: "validation", fields: { "product.name": "required" } },
    };
  const content = validateCandidatePartContent(draft);
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
    ...sourceMetadata(candidate.sourceInfo, candidate.sourceSnapshot),
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

const candidateSummary = (
  candidate: CandidatePart | CandidatePartV2,
): CandidateSummary => {
  const { name, manufacturer, modelNumber } = candidate.product;
  const sourceState = "sources" in candidate ? candidate : undefined;
  const primarySource = sourceState?.sources.find(
    (source) => source.id === sourceState.primarySourceId,
  );
  const representativePrice =
    sourceState === undefined && "price" in candidate.product
      ? candidate.product.price
      : primarySource?.price;
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

const sourceMetadata = (
  sourceInfo: SourceInfo | undefined,
  sourceSnapshot: SourceSnapshot | undefined,
): Pick<CandidatePart, "sourceInfo" | "sourceSnapshot"> => ({
  ...(sourceInfo === undefined ? {} : { sourceInfo }),
  ...(sourceSnapshot === undefined ? {} : { sourceSnapshot }),
});

export const createCandidateManagementService = (
  dependencies: CandidateManagementServiceDependencies,
): CandidateManagementService &
  CandidateManagementQuery &
  CandidateSourceService => {
  const now = dependencies.now ?? createUtcTimestamp;
  const newProjectId =
    dependencies.createProjectId ?? (() => createUuid() as ProjectId);
  const newCandidateId =
    dependencies.createCandidateId ?? (() => createUuid() as CandidatePartId);
  const classifier: SourceKindClassifier = dependencies.classifier ?? {
    classify: () => "retail",
  };
  const sourceData = dependencies.sourceData;

  const sourceValidation = (candidate: CandidatePartV2) => {
    const checked = validateCandidatePartV2Value(candidate);
    return checked.ok
      ? ({ ok: true, value: candidate } as const)
      : ({
          ok: false,
          error: validationFailure(checked.error.path, checked.error.code),
        } as const);
  };

  const mutateSource = async (
    candidateId: CandidatePartId,
    context: MutationContext,
    change: (
      candidate: CandidatePartV2,
    ) => Result<
      Pick<CandidatePartV2, "sources" | "primarySourceId">,
      ManagementError
    >,
  ): Promise<Result<CandidatePartV2, ManagementError>> => {
    if (sourceData === undefined)
      return { ok: false, error: { kind: "unsupported-data" } };
    const existing = await sourceData.query((snapshot) =>
      snapshot.candidateParts.find((candidate) => candidate.id === candidateId),
    );
    if (!existing.ok)
      return { ok: false, error: managementError(existing.error.code) };
    if (existing.value === undefined)
      return { ok: false, error: { kind: "not-found", entity: "candidate" } };
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
    } as CandidatePartV2;
    const validated = sourceValidation(updated);
    if (!validated.ok) return validated;
    const mutation = await sourceData.mutateCandidate(updated, context);
    return mutation.ok
      ? { ok: true, value: updated }
      : {
          ok: false,
          error: managementError(mutation.error.code, "candidate"),
        };
  };

  const ruleFailure = (kind: string): ManagementError =>
    kind === "source-not-found"
      ? { kind: "not-found", entity: "source" }
      : { kind: "validation", fields: { sources: kind } };

  const mutateProject = async (
    project: Project,
    kind: "create" | "update",
    context: MutationContext,
  ): Promise<Result<Project, ManagementError>> => {
    const mutation = await dependencies.data.mutate(
      commandFor({ kind, entity: "project", value: project }, context),
    );
    return mutation.ok
      ? { ok: true, value: project }
      : { ok: false, error: managementError(mutation.error.code, "project") };
  };

  const mutateCandidate = async (
    candidate: CandidatePart,
    kind: "create" | "update",
    context: MutationContext,
  ): Promise<Result<CandidatePart, ManagementError>> => {
    const mutation = await dependencies.data.mutate(
      commandFor({ kind, entity: "candidatePart", value: candidate }, context),
    );
    return mutation.ok
      ? { ok: true, value: candidate }
      : { ok: false, error: managementError(mutation.error.code, "candidate") };
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
            kind: "validation",
            fields: { "source.pageUrl": "invalid-url" },
          },
        };
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
        return {
          ok: false,
          error: {
            kind: "validation",
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
        const result = candidateSourcePolicy.add(candidate, source);
        return result.ok
          ? result
          : { ok: false, error: ruleFailure(result.error.kind) };
      });
    },
    async updateSource(input, context) {
      return mutateSource(input.candidateId, context, (candidate) => {
        const result = candidateSourcePolicy.update(candidate, input.source);
        return result.ok
          ? result
          : { ok: false, error: ruleFailure(result.error.kind) };
      });
    },
    async removeSource(input, context) {
      return mutateSource(input.candidateId, context, (candidate) => {
        const result = candidateSourcePolicy.remove(
          candidate,
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
          candidate,
          input.sourceId,
        );
        return result.ok
          ? result
          : { ok: false, error: ruleFailure(result.error.kind) };
      });
    },
    async createProject(input: CreateProjectInput, context: MutationContext) {
      const name = normalizeName(input.name);
      if (!name.ok) return name;
      const createdAt = now();
      return mutateProject(
        {
          id: newProjectId(),
          name: name.value,
          createdAt,
          updatedAt: createdAt,
        },
        "create",
        context,
      );
    },

    async renameProject(input: RenameProjectInput, context: MutationContext) {
      const name = normalizeName(input.name);
      if (!name.ok) return name;
      const existing = await dependencies.data.query((root) =>
        root.projects.find((project) => project.id === input.id),
      );
      if (!existing.ok)
        return { ok: false, error: managementError(existing.error.code) };
      if (existing.value === undefined)
        return { ok: false, error: { kind: "not-found", entity: "project" } };
      return mutateProject(
        { ...existing.value, name: name.value, updatedAt: now() },
        "update",
        context,
      );
    },

    async deleteProject(id, context) {
      const mutation = await dependencies.data.mutate(
        commandFor({ kind: "delete", entity: "project", id }, context),
      );
      return mutation.ok
        ? { ok: true, value: undefined }
        : { ok: false, error: managementError(mutation.error.code, "project") };
    },

    async createCandidate(input: CandidateDraft, context: MutationContext) {
      if ("sources" in input) {
        if (!hasProductName(input))
          return {
            ok: false,
            error: {
              kind: "validation",
              fields: { "product.name": "required" },
            },
          };
        if (sourceData === undefined)
          return { ok: false, error: { kind: "unsupported-data" } };
        const createdAt = now();
        const checkedDraft = validateCandidatePartV2Value({
          ...input,
          id: newCandidateId(),
          createdAt,
          updatedAt: createdAt,
        });
        if (!checkedDraft.ok)
          return {
            ok: false,
            error: validationFailure(
              checkedDraft.error.path,
              checkedDraft.error.code,
            ),
          };
        const sourceDraft = checkedDraft.value;
        const classifySource = (source: CandidatePartV2["sources"][number]) =>
          source.pageUrl === undefined
            ? source
            : {
                ...source,
                kind: resolveSourceKind(
                  source.pageUrl,
                  source.kind,
                  classifier,
                ),
              };
        const [firstSource, ...remainingSources] = sourceDraft.sources;
        const primarySourceId = sourceDraft.primarySourceId;
        let sourceState: CandidateSourceState;
        if (firstSource === undefined) {
          sourceState = { sources: [] };
        } else {
          if (primarySourceId === undefined)
            return {
              ok: false,
              error: validationFailure("$.primarySourceId", "missing-field"),
            };
          sourceState = {
            sources: [
              classifySource(firstSource),
              ...remainingSources.map(classifySource),
            ],
            primarySourceId,
          };
        }
        const candidateBase = {
          id: sourceDraft.id,
          projectId: sourceDraft.projectId,
          category: sourceDraft.category,
          product: sourceDraft.product,
          normalizedAttributes: sourceDraft.normalizedAttributes,
          ...(sourceDraft.sourceSnapshot === undefined
            ? {}
            : { sourceSnapshot: sourceDraft.sourceSnapshot }),
          createdAt,
          updatedAt: createdAt,
        };
        const candidate: CandidatePartV2 = { ...candidateBase, ...sourceState };
        const validated = sourceValidation(candidate);
        if (!validated.ok) return validated;
        const mutation = await sourceData.mutateCandidate(candidate, context);
        return mutation.ok
          ? { ok: true, value: candidate }
          : {
              ok: false,
              error: managementError(mutation.error.code, "candidate"),
            };
      }
      const validated = candidateValidation(input);
      if (!validated.ok) return validated;
      const createdAt = now();
      const candidate: CandidatePart = {
        id: newCandidateId(),
        projectId: input.projectId,
        category: input.category,
        product: input.product,
        ...sourceMetadata(input.sourceInfo, input.sourceSnapshot),
        normalizedAttributes: input.normalizedAttributes,
        createdAt,
        updatedAt: createdAt,
      };
      return mutateCandidate(candidate, "create", context);
    },
    async updateCandidate(
      input: LegacyUpdateCandidateInput,
      context: MutationContext,
    ) {
      const validated = candidateValidation(input.draft);
      if (!validated.ok) return validated;
      const existing = await dependencies.data.query((root) =>
        root.candidateParts.find((candidate) => candidate.id === input.id),
      );
      if (!existing.ok)
        return { ok: false, error: managementError(existing.error.code) };
      if (existing.value === undefined)
        return { ok: false, error: { kind: "not-found", entity: "candidate" } };
      /**
       * A category change must not drop the shared fields, but it must not
       * discard edits confirmed in the same submission either: the draft is the
       * intended state, so omitted metadata falls back to the stored value.
       * An update never reparents a candidate.
       */
      const updated: CandidatePart = {
        id: existing.value.id,
        projectId: existing.value.projectId,
        category: input.draft.category,
        product: input.draft.product,
        ...sourceMetadata(
          input.draft.sourceInfo ?? existing.value.sourceInfo,
          input.draft.sourceSnapshot ?? existing.value.sourceSnapshot,
        ),
        normalizedAttributes: input.draft.normalizedAttributes,
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
            error: managementError(mutation.error.code, "candidate"),
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
      return result.ok
        ? result
        : { ok: false as const, error: managementError(result.error.code) };
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
      return result.ok
        ? result
        : { ok: false as const, error: managementError(result.error.code) };
    },
    async getCandidateDraft(id) {
      const result = await dependencies.data.query((root) =>
        root.candidateParts.find((candidate) => candidate.id === id),
      );
      if (!result.ok)
        return { ok: false, error: managementError(result.error.code) };
      return result.value === undefined
        ? { ok: false, error: { kind: "not-found", entity: "candidate" } }
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
      return result.ok
        ? result
        : { ok: false as const, error: managementError(result.error.code) };
    },
  };
};
