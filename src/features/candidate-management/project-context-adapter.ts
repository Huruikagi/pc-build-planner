import type {
  ProjectContextChangeGuardRegistrationPort,
  ProjectContextChangeIntent,
  ProjectContextCommandPort,
  ProjectContextReadPort,
} from "../../project-context/public.js";
import type {
  CandidateProjectDraftGuard,
  CurrentProjectPort,
  CurrentProjectResolution,
} from "./contracts.js";

export const CANDIDATE_MANAGEMENT_GUARD_ID =
  "candidate-management.unsaved-draft";

export type CandidateProjectContextAdapterStartError = {
  readonly kind: "guard-registration-failed";
};

export interface CandidateProjectContextAdapter extends CurrentProjectPort {
  start():
    | { readonly ok: true; readonly value: () => void }
    | {
        readonly ok: false;
        readonly error: CandidateProjectContextAdapterStartError;
      };
}

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
  readonly guards?: ProjectContextChangeGuardRegistrationPort;
  readonly draftGuard?: CandidateProjectDraftGuard;
}): CandidateProjectContextAdapter => ({
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
  start() {
    if (
      dependencies.guards === undefined ||
      dependencies.draftGuard === undefined
    )
      return { ok: true, value: () => {} };
    const registered = dependencies.guards.register({
      id: CANDIDATE_MANAGEMENT_GUARD_ID,
      async evaluate() {
        return {
          ok: true,
          value: dependencies.draftGuard?.isDirty()
            ? { kind: "confirmation-required" }
            : { kind: "allow" },
        };
      },
      notifyForced(intent: ProjectContextChangeIntent) {
        if (intent.kind === "select-project" && intent.cause === "user") {
          dependencies.draftGuard?.discardConfirmedSwitch(
            intent.from,
            intent.to,
          );
          return;
        }
        dependencies.draftGuard?.preserveForcedSwitch(intent.from);
      },
    });
    if (!registered.ok)
      return {
        ok: false,
        error: { kind: "guard-registration-failed" },
      };
    let active = true;
    return {
      ok: true,
      value: () => {
        if (!active) return;
        active = false;
        registered.value();
      },
    };
  },
});
