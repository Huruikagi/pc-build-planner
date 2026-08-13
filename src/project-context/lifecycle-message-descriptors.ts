import type { ProjectCatalogItem } from "./contracts.js";
import type { ProjectLifecycleError } from "./lifecycle-service.js";
import type { ProjectLifecycleStateSnapshot } from "./lifecycle-state.js";

export type ProjectLifecycleOperation =
  | "create"
  | "rename"
  | "delete"
  | "refresh";

export type ProjectLifecycleMessageDescriptor =
  | { readonly intent: "project-list" }
  | { readonly intent: "create-project" }
  | { readonly intent: "rename-project"; readonly projectName: string }
  | {
      readonly intent: "confirm-delete";
      readonly projectName: string;
      readonly impact: "owned-candidates";
    }
  | { readonly intent: "name-required" }
  | {
      readonly intent: "operation-pending";
      readonly operation: ProjectLifecycleOperation;
    }
  | {
      readonly intent: "operation-failed";
      readonly reason: ProjectLifecycleError["kind"];
    }
  | { readonly intent: "retry-refresh" };

export interface ProjectLifecycleMessageResolver {
  resolve(descriptor: ProjectLifecycleMessageDescriptor): string;
}

export interface ProjectLifecycleMessageReconciliation {
  readonly snapshot: ProjectLifecycleStateSnapshot;
  readonly projects: readonly ProjectCatalogItem[];
  /** The lifecycle state intentionally stores only pending, so its caller supplies the active semantic operation. */
  readonly operation?: ProjectLifecycleOperation;
}

/** Reconciles public lifecycle state into locale- and message-key-independent display intents. */
export const describeProjectLifecycleMessages = ({
  snapshot,
  projects,
  operation,
}: ProjectLifecycleMessageReconciliation): readonly ProjectLifecycleMessageDescriptor[] => {
  const descriptors: ProjectLifecycleMessageDescriptor[] = [
    { intent: "project-list" },
    { intent: "create-project" },
    ...projects.map(
      ({ name }): ProjectLifecycleMessageDescriptor => ({
        intent: "rename-project",
        projectName: name,
      }),
    ),
  ];

  if (snapshot.deletion !== null) {
    descriptors.push({
      intent: "confirm-delete",
      projectName: snapshot.deletion.projectName,
      impact: "owned-candidates",
    });
  }
  if (snapshot.fieldError === "required") {
    descriptors.push({ intent: "name-required" });
  }
  if (snapshot.error !== null && snapshot.error.kind !== "validation") {
    descriptors.push({
      intent: "operation-failed",
      reason: snapshot.error.kind,
    });
  }
  if (snapshot.pending && operation !== undefined) {
    descriptors.push({ intent: "operation-pending", operation });
  }
  if (snapshot.error?.kind === "committed-refresh-failed") {
    descriptors.push({ intent: "retry-refresh" });
  }

  return Object.freeze(
    descriptors.map((descriptor) => Object.freeze(descriptor)),
  );
};
