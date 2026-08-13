import {
  createRequestId,
  type FoundationError,
  type Project,
  type ProjectId,
  type RequestId,
  type Result,
  type Revision,
} from "../domain/public.js";
import type {
  FoundationScopedDataPort,
  MutationReceipt,
} from "../persistence/public.js";
import type {
  ProjectLifecycleDataError,
  ProjectLifecycleDataPort,
  ProjectLifecycleMutation,
  ProjectLifecycleMutationContext,
} from "./contracts.js";

/** Runtime composition が受け取る foundation の最小 capability。 */
export type ProjectLifecycleFoundationPort = FoundationScopedDataPort;

const dataError = (error: FoundationError): ProjectLifecycleDataError => {
  if (error.code === "validation") {
    if (error.reason === "entity-not-found") return { kind: "not-found" };
    if (error.reason === "entity-already-exists") return { kind: "conflict" };
  }
  switch (error.code) {
    case "revision-conflict":
    case "request-conflict":
      return { kind: "conflict" };
    case "maintenance-active":
    case "recovery-active":
      return { kind: "maintenance" };
    case "access-denied":
    case "lock-unavailable":
    case "storage-unavailable":
      return { kind: "storage" };
    case "quota-exceeded":
      return { kind: "quota" };
    case "validation":
    case "corrupt-data":
    case "unsupported-version":
    case "migration-failed":
    case "repair-failed":
    case "stale-recovery-state":
    case "stale-fence":
    case "stale-assessment":
    case "precommit-cleanup-pending":
      return { kind: "unsupported-data" };
  }
};

const foundationOperation = (operation: ProjectLifecycleMutation) => {
  switch (operation.kind) {
    case "create":
      return {
        kind: "create" as const,
        entity: "project" as const,
        value: operation.project,
      };
    case "update":
      return {
        kind: "update" as const,
        entity: "project" as const,
        value: operation.project,
      };
    case "delete":
      return {
        kind: "delete" as const,
        entity: "project" as const,
        id: operation.projectId,
      };
  }
};

export const createFoundationProjectLifecycleDataPort = (
  foundation: ProjectLifecycleFoundationPort,
  newRequestId: () => RequestId = createRequestId,
): ProjectLifecycleDataPort => {
  return Object.freeze({
    async createMutationContext() {
      let queried: Result<Revision, FoundationError>;
      try {
        queried = await foundation.query((root) => root.revision);
      } catch {
        return { ok: false as const, error: { kind: "storage" as const } };
      }
      return queried.ok
        ? {
            ok: true as const,
            value: {
              requestId: newRequestId(),
              expectedRevision: queried.value,
            },
          }
        : { ok: false as const, error: dataError(queried.error) };
    },
    async find(projectId: ProjectId) {
      let queried: Result<Project | undefined, FoundationError>;
      try {
        queried = await foundation.query((root) =>
          root.projects.find((project) => project.id === projectId),
        );
      } catch {
        return { ok: false as const, error: { kind: "storage" as const } };
      }
      if (!queried.ok)
        return { ok: false as const, error: dataError(queried.error) };
      return { ok: true as const, value: queried.value };
    },
    async mutate(
      operation: ProjectLifecycleMutation,
      context: ProjectLifecycleMutationContext,
    ) {
      let committed: Result<MutationReceipt, FoundationError>;
      try {
        committed = await foundation.mutate({
          requestId: context.requestId,
          expectedRevision: context.expectedRevision,
          operation: foundationOperation(operation),
        });
      } catch {
        return { ok: false as const, error: { kind: "storage" as const } };
      }
      return committed.ok
        ? {
            ok: true as const,
            value: {
              revision: committed.value.committedRevision,
              replayed: committed.value.replayed,
            },
          }
        : { ok: false as const, error: dataError(committed.error) };
    },
  });
};
