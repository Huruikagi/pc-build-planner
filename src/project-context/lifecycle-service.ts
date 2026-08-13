import {
  err,
  ok,
  type Project,
  type ProjectId,
  type Result,
  type UtcTimestamp,
} from "../domain/public.js";
import type {
  ProjectContextSnapshot,
  ProjectLifecycleDataError,
  ProjectLifecycleDataPort,
  ProjectLifecycleMutation,
} from "./contracts.js";
import type { ProjectContextCommandError } from "./service.js";

export type ProjectLifecycleError =
  | {
      readonly kind: "validation";
      readonly fields: Readonly<Record<"name", "required">>;
    }
  | ProjectLifecycleDataError
  | { readonly kind: "operation-in-progress" }
  | { readonly kind: "committed-refresh-failed" };

export type ProjectLifecycleRefreshError =
  | ProjectContextCommandError
  | { readonly kind: "operation-in-progress" };

export interface ProjectLifecycleCommandResult {
  readonly projectId: ProjectId;
  readonly snapshot: ProjectContextSnapshot;
}

export interface ProjectLifecycleService {
  create(
    name: string,
  ): Promise<Result<ProjectLifecycleCommandResult, ProjectLifecycleError>>;
  rename(
    projectId: ProjectId,
    name: string,
  ): Promise<Result<ProjectLifecycleCommandResult, ProjectLifecycleError>>;
  retryRefresh(): Promise<
    Result<ProjectContextSnapshot, ProjectLifecycleRefreshError>
  >;
}

export const createProjectLifecycleService = (input: {
  readonly data: ProjectLifecycleDataPort;
  readonly context: {
    refresh(): Promise<
      Result<ProjectContextSnapshot, ProjectContextCommandError>
    >;
  };
  readonly createProjectId: () => ProjectId;
  readonly now: () => UtcTimestamp;
}): ProjectLifecycleService => {
  let operationInProgress = false;
  let recoveryRequired = false;
  const validationFailure = (): Result<never, ProjectLifecycleError> =>
    err({ kind: "validation", fields: { name: "required" } });
  const storageFailure = (): Result<never, ProjectLifecycleDataError> =>
    err({ kind: "storage" });
  const runSingleFlight = async <T, E>(
    operation: () => Promise<Result<T, E>>,
  ): Promise<Result<T, E | { readonly kind: "operation-in-progress" }>> => {
    if (operationInProgress) return err({ kind: "operation-in-progress" });
    operationInProgress = true;
    try {
      return await operation();
    } finally {
      operationInProgress = false;
    }
  };
  const runLifecycleCommand = async <T>(
    operation: () => Promise<Result<T, ProjectLifecycleError>>,
  ): Promise<Result<T, ProjectLifecycleError>> => {
    if (recoveryRequired) return err({ kind: "operation-in-progress" });
    return runSingleFlight(operation);
  };
  const commit = async (
    projectId: ProjectId,
    operation: ProjectLifecycleMutation,
  ): Promise<Result<ProjectLifecycleCommandResult, ProjectLifecycleError>> => {
    let mutationContext: Awaited<
      ReturnType<ProjectLifecycleDataPort["createMutationContext"]>
    >;
    try {
      mutationContext = await input.data.createMutationContext();
    } catch {
      return storageFailure();
    }
    if (!mutationContext.ok) return mutationContext;
    let committed: Awaited<ReturnType<ProjectLifecycleDataPort["mutate"]>>;
    try {
      committed = await input.data.mutate(operation, mutationContext.value);
    } catch {
      return storageFailure();
    }
    if (!committed.ok) return committed;
    try {
      const refreshed = await input.context.refresh();
      if (!refreshed.ok) {
        recoveryRequired = true;
        return err({ kind: "committed-refresh-failed" });
      }
      return ok({ projectId, snapshot: refreshed.value });
    } catch {
      recoveryRequired = true;
      return err({ kind: "committed-refresh-failed" });
    }
  };
  return {
    create: (name) =>
      runLifecycleCommand(async () => {
        const trimmedName = name.trim();
        if (trimmedName.length === 0) return validationFailure();
        const projectId = input.createProjectId();
        const timestamp = input.now();
        return commit(projectId, {
          kind: "create",
          project: {
            id: projectId,
            name: trimmedName,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        });
      }),
    rename: (projectId, name) =>
      runLifecycleCommand(async () => {
        const trimmedName = name.trim();
        if (trimmedName.length === 0) return validationFailure();
        let found: Awaited<ReturnType<ProjectLifecycleDataPort["find"]>>;
        try {
          found = await input.data.find(projectId);
        } catch {
          return storageFailure();
        }
        if (!found.ok) return found;
        if (found.value === undefined) return err({ kind: "not-found" });
        const project: Project = {
          ...found.value,
          name: trimmedName,
          updatedAt: input.now(),
        };
        return commit(projectId, { kind: "update", project });
      }),
    retryRefresh: () =>
      runSingleFlight(async () => {
        try {
          const refreshed = await input.context.refresh();
          if (refreshed.ok) recoveryRequired = false;
          return refreshed;
        } catch {
          return err({ kind: "context-unavailable" });
        }
      }),
  };
};
