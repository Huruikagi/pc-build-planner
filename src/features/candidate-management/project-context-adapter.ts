import type {
  ProjectContextCommandPort,
  ProjectContextReadPort,
} from "../../project-context/public.js";
import type {
  CurrentProjectPort,
  CurrentProjectResolution,
} from "./contracts.js";

const resolve = (
  snapshot: ReturnType<ProjectContextReadPort["getSnapshot"]>,
): CurrentProjectResolution =>
  snapshot.status === "ready"
    ? { status: "resolved", projectId: snapshot.selectedProjectId }
    : { status: "unresolved" };

/** Keeps project-context as the only source of a candidate save target. */
export const createProjectContextAdapter = (dependencies: {
  readonly read: ProjectContextReadPort;
  readonly commands: Pick<ProjectContextCommandPort, "refresh">;
}): CurrentProjectPort => ({
  getCurrentProject: () => resolve(dependencies.read.getSnapshot()),
  subscribe(listener) {
    return dependencies.read.subscribe(() => listener());
  },
  async refresh() {
    const result = await dependencies.commands.refresh();
    return result.ok
      ? { ok: true, value: resolve(result.value) }
      : { ok: false, error: { kind: "context-unavailable" } };
  },
});
