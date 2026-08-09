/**
 * The backup/restore feature's upstream seams, expressed as a consumer that
 * imports only producer-owned public entries.  `typecheck:public-consumer`
 * keeps these capability limits stable before the feature wires them together.
 */
import type {
  OperationKind,
  OperationPolicy,
} from "../../src/application-shell/public.js";
import type { Result } from "../../src/domain/public.js";
import {
  decodeWithProfile,
  inspectJsonSafety,
  plainObject,
  safeString,
  tagged,
  z,
} from "../../src/domain/runtime-schema/public.js";
import type {
  BackupRestoreAssessment,
  BackupRestoreAssessmentTicket,
  BackupRestoreCommitOutcome,
  BackupRestoreDataPort,
  BackupRestoreFinalizationTicket,
} from "../../src/persistence/public.js";
import type {
  ProjectContextCommandPort,
  ProjectContextReplacementGuardPort,
} from "../../src/project-context/public.js";

type ExchangeError =
  | { readonly code: "invalid-structure"; readonly path: string }
  | { readonly code: "not-json"; readonly path: string };

const invalid = <T>(schema: T): T =>
  tagged(schema as never, "invalid-structure") as T;

const consumerEnvelope = plainObject(
  { name: invalid(safeString()) },
  { nonObjectTag: "invalid-structure", unsafeObjectTag: "invalid-structure" },
);

/** Configured schema, JSON safety and the owner-owned error/path projection only. */
export const decodeBackupRestoreConsumerEnvelope = (
  input: unknown,
): Result<{ readonly name: string }, ExchangeError> => {
  if (inspectJsonSafety(input) !== undefined)
    return { ok: false, error: { code: "not-json", path: "$" } };
  return decodeWithProfile(consumerEnvelope, input, {
    toError: (_issue, canonicalPath) => ({
      code: "invalid-structure" as const,
      path: canonicalPath,
    }),
  });
};

/** The configured vendor namespace is only reachable through the canonical entry. */
export const consumerSchemaArray = () => z.array(consumerEnvelope);

export const inspectBackupRestoreAssessment = (
  assessment: BackupRestoreAssessment,
) => ({
  mode: assessment.mode,
  requiredBytes: assessment.requiredBytes,
  currentAnomaly: assessment.currentAnomaly,
  ticket: assessment.ticket,
});

export const commitAssessedBackupRestore = (
  port: BackupRestoreDataPort,
  candidate: unknown,
  expectedMode: BackupRestoreAssessment["mode"],
  assessment: BackupRestoreAssessmentTicket,
): Promise<Result<BackupRestoreCommitOutcome, unknown>> =>
  port.commit({ candidate, expectedMode, assessment });

export const inspectBackupRestoreCommitOutcome = (
  outcome: BackupRestoreCommitOutcome,
): BackupRestoreFinalizationTicket | null =>
  outcome.kind === "committed-finalization-required"
    ? outcome.finalization
    : null;

export const rejectBackupRestoreInternals = (
  port: BackupRestoreDataPort,
  assessment: BackupRestoreAssessment,
): void => {
  // @ts-expect-error raw root queries are not backup/restore capabilities.
  void port.query;
  // @ts-expect-error ordinary mutations are not backup/restore capabilities.
  void port.mutate;
  // @ts-expect-error assessment hides persistence revision.
  void assessment.revision;
  // @ts-expect-error assessment hides candidate fingerprints.
  void assessment.fingerprint;
  // @ts-expect-error assessment hides candidate digests.
  void assessment.digest;
  // @ts-expect-error assessment hides persistence cursors.
  void assessment.cursor;
  // @ts-expect-error assessment hides maintenance fencing.
  void assessment.fence;
  // @ts-expect-error backup/restore consumers never receive a raw root.
  void port.root;
  // @ts-expect-error backup/restore consumers never receive Storage.
  void port.storage;
  // @ts-expect-error backup/restore consumers never receive locks.
  void port.lock;
  // @ts-expect-error backup/restore consumers never receive repositories.
  void port.repository;
  // @ts-expect-error backup/restore consumers never receive authority factories.
  void port.authorityFactory;
};

export const prepareBackupRestoreReplacement = async (
  guard: ProjectContextReplacementGuardPort,
  commands: Pick<ProjectContextCommandPort, "refresh">,
) => {
  const prepared = await guard.prepare();
  if (!prepared.ok) return prepared;
  if (prepared.value.kind === "confirmation-required")
    return guard.confirm(prepared.value.confirmation.id);
  const begun = await guard.begin(prepared.value.permit.id);
  if (!begun.ok) return begun;
  await guard.complete(prepared.value.permit.id, "cancelled");
  return commands.refresh();
};

export const rejectProjectContextInternals = (
  guard: ProjectContextReplacementGuardPort,
  commands: Pick<ProjectContextCommandPort, "refresh">,
): void => {
  // @ts-expect-error replacement consumer cannot reach the guard registry.
  void guard.registry;
  // @ts-expect-error refresh-only consumer cannot select a project.
  void commands.select;
  // @ts-expect-error replacement guard never exposes draft content.
  void guard.draft;
};

export const observeBackupRestoreOperationPolicy = (
  policy: OperationPolicy,
): { readonly read: boolean; readonly recovery: boolean } => ({
  read: policy.isAllowed("read" satisfies OperationKind),
  recovery: policy.isAllowed("recovery" satisfies OperationKind),
});

export const subscribeBackupRestoreOperationPolicy = (
  policy: OperationPolicy,
  listener: () => void,
): (() => void) => policy.subscribe(listener);

export const rejectMutationAsRecovery = (policy: OperationPolicy): void => {
  // @ts-expect-error the operation kind vocabulary is closed by the shell.
  policy.isAllowed("restore");
};
