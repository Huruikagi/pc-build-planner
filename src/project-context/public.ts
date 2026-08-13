import type { ProjectId, Result } from "../domain/public.js";
import type {
  ProjectContextChangeGuard,
  ProjectContextSnapshot,
} from "./contracts.js";
import type {
  ProjectChangeGuardError,
  ProjectReplacementConfirmation,
  ProjectReplacementPermit,
} from "./guard-coordinator.js";
import type {
  ProjectLifecycleCommandResult,
  ProjectLifecycleError,
  ProjectLifecycleRefreshError,
  ProjectLifecycleService,
} from "./lifecycle-service.js";
import type {
  ProjectContextCommandError,
  ProjectContextService,
  ProjectSelectionOutcome,
} from "./service.js";

export type {
  ProjectCatalogItem,
  ProjectCatalogSource,
  ProjectContextChangeGuard,
  ProjectContextChangeIntent,
  ProjectContextSnapshot,
} from "./contracts.js";
export type {
  ProjectLifecycleCommandResult,
  ProjectLifecycleError,
  ProjectLifecycleRefreshError,
} from "./lifecycle-service.js";
export type {
  ProjectContextCommandError,
  ProjectSelectionOutcome,
} from "./service.js";

export interface ProjectContextReadPort {
  getSnapshot(): ProjectContextSnapshot;
  subscribe(listener: (snapshot: ProjectContextSnapshot) => void): () => void;
}

export interface ProjectContextCommandPort {
  select(
    projectId: Parameters<ProjectContextService["select"]>[0],
  ): Promise<Result<ProjectSelectionOutcome, ProjectContextCommandError>>;
  confirm(confirmationId: string): ReturnType<ProjectContextService["confirm"]>;
  cancel(confirmationId: string): ReturnType<ProjectContextService["cancel"]>;
  refresh(): ReturnType<ProjectContextService["refresh"]>;
}

export interface ProjectContextChangeGuardRegistrationPort {
  register(
    guard: ProjectContextChangeGuard,
  ): ReturnType<ProjectContextService["registerGuard"]>;
}

export interface ProjectContextReplacementGuardPort {
  prepare(): Promise<
    Result<
      | {
          readonly kind: "permitted";
          readonly permit: ProjectReplacementPermit;
        }
      | {
          readonly kind: "confirmation-required";
          readonly confirmation: ProjectReplacementConfirmation;
        },
      ProjectChangeGuardError
    >
  >;
  confirm(
    confirmationId: string,
  ): ReturnType<ProjectContextService["confirmReplacement"]>;
  cancel(
    confirmationId: string,
  ): ReturnType<ProjectContextService["cancelReplacement"]>;
  begin(
    permitId: string,
  ): ReturnType<ProjectContextService["beginReplacement"]>;
  complete(
    permitId: string,
    outcome: "succeeded" | "failed" | "cancelled",
  ): ReturnType<ProjectContextService["completeReplacement"]>;
}

export interface ProjectContextPublicApi {
  readonly read: ProjectContextReadPort;
  readonly commands: ProjectContextCommandPort;
  readonly guards: ProjectContextChangeGuardRegistrationPort;
  readonly replacementGuard: ProjectContextReplacementGuardPort;
  readonly lifecycle: ProjectLifecyclePort;
}

export interface ProjectContextCorePublicApi
  extends Omit<ProjectContextPublicApi, "lifecycle"> {}

export interface ProjectLifecyclePort {
  create(
    name: string,
  ): Promise<Result<ProjectLifecycleCommandResult, ProjectLifecycleError>>;
  rename(
    projectId: ProjectId,
    name: string,
  ): Promise<Result<ProjectLifecycleCommandResult, ProjectLifecycleError>>;
  delete(
    projectId: ProjectId,
  ): Promise<Result<ProjectLifecycleCommandResult, ProjectLifecycleError>>;
  retryRefresh(): Promise<
    Result<ProjectContextSnapshot, ProjectLifecycleRefreshError>
  >;
}

export interface ProjectContextPublicDependencies {
  readonly service: ProjectContextService;
  readonly lifecycle: ProjectLifecycleService;
}

/** 通常 consumer へ必要な capability だけを immutable な facade として渡す。 */
export function createProjectContextPublicApi(
  dependencies: Pick<ProjectContextPublicDependencies, "service">,
): ProjectContextCorePublicApi;
export function createProjectContextPublicApi(
  dependencies: ProjectContextPublicDependencies,
): ProjectContextPublicApi;
export function createProjectContextPublicApi(
  dependencies: Pick<ProjectContextPublicDependencies, "service"> &
    Partial<Pick<ProjectContextPublicDependencies, "lifecycle">>,
): ProjectContextCorePublicApi | ProjectContextPublicApi {
  if (dependencies.service === undefined)
    throw new TypeError(
      "Project context public API requires a service dependency.",
    );
  const service = dependencies.service;
  const core: ProjectContextCorePublicApi = {
    read: Object.freeze({
      getSnapshot: () => service.getSnapshot(),
      subscribe: (listener: (snapshot: ProjectContextSnapshot) => void) =>
        service.subscribe(listener),
    }),
    commands: Object.freeze({
      select: (projectId: ProjectId) => service.select(projectId),
      confirm: (confirmationId: string) => service.confirm(confirmationId),
      cancel: (confirmationId: string) => service.cancel(confirmationId),
      refresh: () => service.refresh(),
    }),
    guards: Object.freeze({
      register: (guard: ProjectContextChangeGuard) =>
        service.registerGuard(guard),
    }),
    replacementGuard: Object.freeze({
      prepare: () => service.prepareReplacement(),
      confirm: (confirmationId: string) =>
        service.confirmReplacement(confirmationId),
      cancel: (confirmationId: string) =>
        service.cancelReplacement(confirmationId),
      begin: (permitId: string) => service.beginReplacement(permitId),
      complete: (
        permitId: string,
        outcome: "succeeded" | "failed" | "cancelled",
      ) => service.completeReplacement(permitId, outcome),
    }),
  };
  if (dependencies.lifecycle === undefined) return Object.freeze(core);
  const lifecycle = dependencies.lifecycle;
  return Object.freeze({
    ...core,
    lifecycle: Object.freeze({
      create: (name: string) => lifecycle.create(name),
      rename: (projectId: ProjectId, name: string) =>
        lifecycle.rename(projectId, name),
      delete: (projectId: ProjectId) => lifecycle.delete(projectId),
      retryRefresh: () => lifecycle.retryRefresh(),
    }),
  });
}
