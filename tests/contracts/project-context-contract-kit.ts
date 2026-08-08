import type {
  ProjectContextPublicApi,
  ProjectContextReplacementGuardPort,
} from "../../src/project-context/public.js";

export interface ProjectContextSnapshotExpectation {
  readonly status: "ready" | "empty" | "unavailable";
  readonly selectedProjectId: string | null;
  readonly minimumGeneration: number;
}

/**
 * Downstream owners can reuse this without importing the context service or
 * catalog implementation. It checks only the public read capability.
 */
export const collectProjectContextSnapshotViolations = (
  context: Pick<ProjectContextPublicApi, "read">,
  expectation: ProjectContextSnapshotExpectation,
): readonly string[] => {
  const snapshot = context.read.getSnapshot();
  const violations: string[] = [];
  if (snapshot.status !== expectation.status)
    violations.push(
      "snapshot.status: expected public lifecycle state was not published",
    );
  if (snapshot.selectedProjectId !== expectation.selectedProjectId)
    violations.push(
      "snapshot.selection: selected project does not match the public state",
    );
  if (snapshot.generation < expectation.minimumGeneration)
    violations.push(
      "snapshot.generation: generation regressed or was not published",
    );
  if (snapshot.status === "unavailable" && "catalog" in snapshot)
    violations.push("snapshot.unavailable: catalog must not be exposed");
  return violations;
};

export interface ReplacementContractSubject {
  readonly replacementGuard: ProjectContextReplacementGuardPort;
  commitReplacement(): Promise<"succeeded" | "failed" | "cancelled">;
  refresh(): Promise<void>;
}

/**
 * Shared replacement-owner protocol. The owner retains its replacement data;
 * the kit sees only the public permit lifecycle and a separately injected
 * refresh callback.
 */
export const collectReplacementContractViolations = async (
  subject: ReplacementContractSubject,
): Promise<readonly string[]> => {
  const prepared = await subject.replacementGuard.prepare();
  if (!prepared.ok) return ["replacement.prepare: guard rejected evaluation"];
  const permit =
    prepared.value.kind === "permitted"
      ? prepared.value.permit
      : await subject.replacementGuard.confirm(prepared.value.confirmation.id);
  if ("ok" in permit && !permit.ok)
    return ["replacement.confirm: confirmation could not produce a permit"];
  const activePermit = "ok" in permit ? permit.value : permit;
  const begun = subject.replacementGuard.begin(activePermit.id);
  if (!begun.ok) return ["replacement.begin: valid permit did not begin"];
  const outcome = await subject.commitReplacement();
  const completed = await subject.replacementGuard.complete(
    activePermit.id,
    outcome,
  );
  if (!completed.ok)
    return ["replacement.complete: terminal permit completion failed"];
  if (outcome === "succeeded") await subject.refresh();
  return [];
};
