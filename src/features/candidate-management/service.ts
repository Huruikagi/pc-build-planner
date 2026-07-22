import {
  type CandidatePart,
  type CandidatePartId,
  createUtcTimestamp,
  createUuid,
  type Project,
  type ProjectId,
  type Result,
  type SourceInfo,
  type SourceSnapshot,
  type UtcTimestamp,
  validateCandidatePartContent,
} from "../../domain/public.js";
import type {
  FoundationScopedDataPort,
  RootMutationCommand,
} from "../../persistence/public.js";
import type {
  CandidateDraft,
  CandidateManagementService,
  CandidateQuery,
  CandidateSummary,
  CreateProjectInput,
  ManagementError,
  MutationContext,
  RenameProjectInput,
  UpdateCandidateInput,
} from "./contracts.js";

export interface CandidateManagementServiceDependencies {
  readonly data: FoundationScopedDataPort;
  readonly now?: () => UtcTimestamp;
  readonly createProjectId?: () => ProjectId;
  readonly createCandidateId?: () => CandidatePartId;
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

const candidateSummary = (candidate: CandidatePart): CandidateSummary => {
  const { name, price, manufacturer, modelNumber } = candidate.product;
  return {
    id: candidate.id,
    projectId: candidate.projectId,
    category: candidate.category,
    ...(name === undefined ? {} : { name }),
    ...(price === undefined ? {} : { price }),
    ...(manufacturer === undefined ? {} : { manufacturer }),
    ...(modelNumber === undefined ? {} : { modelNumber }),
    hasMissingDetails:
      name === undefined ||
      price === undefined ||
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
): CandidateManagementService & CandidateQuery => {
  const now = dependencies.now ?? createUtcTimestamp;
  const newProjectId =
    dependencies.createProjectId ?? (() => createUuid() as ProjectId);
  const newCandidateId =
    dependencies.createCandidateId ?? (() => createUuid() as CandidatePartId);

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
      input: UpdateCandidateInput,
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
      const result = await dependencies.data.query((root) =>
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
