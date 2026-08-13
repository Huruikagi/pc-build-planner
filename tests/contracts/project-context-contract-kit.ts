import type {
  ProjectLifecycleMessageDescriptor,
  ProjectLifecycleMessageResolver,
} from "../../src/project-context/lifecycle-message-descriptors.js";
import type {
  ProjectContextPublicApi,
  ProjectContextReplacementGuardPort,
  ProjectLifecyclePort,
} from "../../src/project-context/public.js";

export const PROJECT_LIFECYCLE_DOWNSTREAM_CONTRACT = Object.freeze({
  hostLocator: "[data-project-lifecycle-host='true']",
  presentationLocator: "[data-project-lifecycle='presentation']",
  legacyCandidateProjectUiCount: 0,
  revalidationTrigger: "ui-message-catalog+project-candidate-management",
} as const);

export interface ProjectLifecycleDownstreamContractSubject {
  readonly lifecycle: ProjectLifecyclePort;
  readonly messages: ProjectLifecycleMessageResolver;
  readonly hostLocator: string;
  readonly presentationLocator: string;
  readonly legacyCandidateProjectUiCount: number;
  readonly revalidationTrigger: string;
  readonly descriptorIntents: readonly ProjectLifecycleMessageDescriptor["intent"][];
}

/**
 * Migration seam reused by the catalog owner and candidate host owner. It
 * describes injected capabilities and stable host expectations only; it does
 * not import either downstream implementation or a physical message catalog.
 */
export const collectProjectLifecycleDownstreamContractViolations = (
  subject: ProjectLifecycleDownstreamContractSubject,
): readonly string[] => {
  const expected = PROJECT_LIFECYCLE_DOWNSTREAM_CONTRACT;
  const violations: string[] = [];
  for (const capability of [
    "create",
    "rename",
    "delete",
    "retryRefresh",
  ] as const)
    if (typeof subject.lifecycle[capability] !== "function")
      violations.push(`lifecycle.capability: ${capability} must be injected`);
  if (typeof subject.messages.resolve !== "function")
    violations.push("lifecycle.messages: semantic resolver must be injected");
  if (subject.hostLocator !== expected.hostLocator)
    violations.push("lifecycle.host: stable host locator changed");
  if (subject.presentationLocator !== expected.presentationLocator)
    violations.push(
      "lifecycle.presentation: stable presentation locator changed",
    );
  if (
    subject.legacyCandidateProjectUiCount !==
    expected.legacyCandidateProjectUiCount
  )
    violations.push("lifecycle.migration: legacy candidate project UI remains");
  if (subject.revalidationTrigger !== expected.revalidationTrigger)
    violations.push("lifecycle.revalidation: downstream trigger changed");
  if (
    subject.descriptorIntents.length !==
      projectLifecycleDescriptorContract.length ||
    subject.descriptorIntents.some(
      (intent, index) =>
        intent !== projectLifecycleDescriptorContract[index]?.intent,
    )
  )
    violations.push(
      "lifecycle.descriptors: semantic descriptor contract changed",
    );
  return violations;
};

/** Descriptor fixtures are key/value independent and safe for both locale owners. */
export const projectLifecycleDescriptorContract = Object.freeze<
  readonly ProjectLifecycleMessageDescriptor[]
>([
  { intent: "project-list" },
  { intent: "create-project" },
  { intent: "rename-project", projectName: "Synthetic project" },
  {
    intent: "confirm-delete",
    projectName: "Synthetic project",
    impact: "owned-candidates",
  },
  { intent: "name-required" },
  { intent: "operation-pending", operation: "create" },
  { intent: "operation-failed", reason: "storage" },
  { intent: "retry-refresh" },
  { intent: "confirm-delete-action" },
  { intent: "cancel-delete" },
  { intent: "cancel-rename" },
  { intent: "create-project-action" },
  { intent: "save-project-name-action" },
]);

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

export interface UnavailableRecoverySubject {
  readonly context: Pick<ProjectContextPublicApi, "read" | "commands">;
  /** shell が settings 画面を起動できたか。context を理由に拒否してはならない。 */
  openSettings(): boolean | Promise<boolean>;
  /** shell が backup recovery を起動できたか。同上。 */
  openBackupRecovery(): boolean | Promise<boolean>;
}

/**
 * Requirement 8.7. Context が unavailable でも settings と backup recovery の
 * 起動が妨げられないことを、公開 read / command capability だけで検証する。
 * shell の具体実装は取り込まず、downstream owner が自分の起動経路を注入する。
 */
export const collectUnavailableRecoveryContractViolations = async (
  subject: UnavailableRecoverySubject,
): Promise<readonly string[]> => {
  const snapshot = subject.context.read.getSnapshot();
  if (snapshot.status !== "unavailable")
    return [
      "recovery.precondition: subject must be observed while context is unavailable",
    ];
  const violations: string[] = [];
  if (!(await subject.openSettings()))
    violations.push(
      "recovery.settings: unavailable context blocked the settings entry point",
    );
  if (!(await subject.openBackupRecovery()))
    violations.push(
      "recovery.backup: unavailable context blocked the backup recovery entry point",
    );
  // 復旧経路は片道であってはならない。retry は公開 command から到達できる。
  if (typeof subject.context.commands.refresh !== "function")
    violations.push(
      "recovery.retry: unavailable context does not expose a public retry",
    );
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
