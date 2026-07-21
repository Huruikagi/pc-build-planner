import {
  createUtcTimestamp,
  createUuid,
  type Project,
  type ProjectId,
  type Result,
  type UtcTimestamp,
} from "../../domain/public.js";
import type {
  FoundationDataPort,
  RootMutationCommand,
} from "../../persistence/public.js";
import type {
  CandidateManagementService,
  CreateProjectInput,
  ManagementError,
  MutationContext,
  RenameProjectInput,
} from "./contracts.js";

export interface CandidateManagementServiceDependencies {
  readonly data: FoundationDataPort;
  readonly now?: () => UtcTimestamp;
  readonly createProjectId?: () => ProjectId;
}

const normalizeName = (name: string): Result<string, ManagementError> => {
  const normalized = name.trim();
  return normalized.length === 0
    ? { ok: false, error: { kind: "validation", fields: { name: "required" } } }
    : { ok: true, value: normalized };
};

const managementError = (code: string): ManagementError => {
  switch (code) {
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

const commandFor = (
  operation: RootMutationCommand["operation"],
  context: MutationContext,
): RootMutationCommand => ({
  requestId: context.requestId,
  expectedRevision:
    context.expectedRevision as RootMutationCommand["expectedRevision"],
  operation,
});

export const createCandidateManagementService = (
  dependencies: CandidateManagementServiceDependencies,
): CandidateManagementService => {
  const now = dependencies.now ?? createUtcTimestamp;
  const newProjectId =
    dependencies.createProjectId ?? (() => createUuid() as ProjectId);

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
      : { ok: false, error: managementError(mutation.error.code) };
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
        : { ok: false, error: managementError(mutation.error.code) };
    },

    async createCandidate() {
      throw new Error("Candidate mutations are not implemented.");
    },
    async updateCandidate() {
      throw new Error("Candidate mutations are not implemented.");
    },
    async deleteCandidate() {
      throw new Error("Candidate mutations are not implemented.");
    },
  };
};
