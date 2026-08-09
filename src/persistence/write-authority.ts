import type { RequestId, Revision } from "../domain/identifiers.js";
import type { FoundationError, Result } from "../domain/result.js";
import type { MaintenanceFence } from "./maintenance.js";
import type {
  MutationCapacityStatus,
  MutationPipeline,
  RootOperation,
} from "./mutation-pipeline.js";
import type {
  RecoveryAssessment,
  RecoveryAssessmentError,
} from "./recovery.js";
import type { ReplacementAssessment } from "./replacement.js";
import type {
  LocalDataRepository,
  RepositoryError,
  RootQuery,
} from "./repository.js";
import type {
  MaintenanceCommand,
  MaintenanceReceipt,
  RecoveryFinalizationCommand,
  ReplacementCommand,
  ReplacementReceipt,
  RequestCommitReceipt,
  RequestPayload,
  RootTransactionRunner,
} from "./root-transaction-runner.js";

export interface RootMutationCommand {
  readonly requestId: RequestId;
  readonly expectedRevision: Revision;
  readonly operation: RootOperation;
  readonly maintenance?: MaintenanceFence;
}

export interface MutationValue {
  readonly capacity: MutationCapacityStatus;
}

export type MutationReceipt = RequestCommitReceipt<MutationValue>;

/**
 * 信頼済み拡張UI contextへ渡す最小権限のdata port。
 * 参照と原子的root mutationだけを転送し、置換・保守capabilityを公開しない。
 */
export interface FoundationScopedDataPort {
  query<T>(query: RootQuery<T>): Promise<Result<T, FoundationError>>;
  mutate(
    command: RootMutationCommand,
  ): Promise<Result<MutationReceipt, FoundationError>>;
}

export interface FoundationDataPort extends FoundationScopedDataPort {
  assessReplacement(
    input: unknown,
  ): Promise<Result<ReplacementAssessment, FoundationError>>;
  replaceRoot(
    command: ReplacementCommand,
  ): Promise<Result<ReplacementReceipt, FoundationError>>;
  runMaintenance(
    command: MaintenanceCommand,
  ): Promise<Result<MaintenanceReceipt, FoundationError>>;
}

export type BackupRestoreCommitMode = "normal" | "recovery";

declare const backupRestoreAssessmentTicketBrand: unique symbol;
export type BackupRestoreAssessmentTicket = string & {
  readonly [backupRestoreAssessmentTicketBrand]: "assessment";
};

declare const backupRestoreFinalizationTicketBrand: unique symbol;
export type BackupRestoreFinalizationTicket = string & {
  readonly [backupRestoreFinalizationTicketBrand]: "finalization";
};

export interface BackupRestoreAssessment {
  readonly mode: BackupRestoreCommitMode;
  readonly requiredBytes: number;
  readonly currentAnomaly?:
    | { readonly code: "corrupt-data" }
    | { readonly code: "unsupported-version"; readonly version: number };
  readonly ticket: BackupRestoreAssessmentTicket;
}

export interface BackupRestoreCommitCommand {
  readonly candidate: unknown;
  readonly expectedMode: BackupRestoreCommitMode;
  readonly assessment: BackupRestoreAssessmentTicket;
}

export interface BackupRestoreCommitReceipt {
  readonly mode: BackupRestoreCommitMode;
  readonly revision: Revision;
}

export type BackupRestoreCommitOutcome =
  | { readonly kind: "committed"; readonly receipt: BackupRestoreCommitReceipt }
  | {
      readonly kind: "committed-finalization-required";
      readonly receipt: BackupRestoreCommitReceipt;
      readonly finalization: BackupRestoreFinalizationTicket;
    };

export interface BackupRestoreDataPort {
  assessReplacement(
    input: unknown,
  ): Promise<Result<BackupRestoreAssessment, FoundationError>>;
  assessRecovery(
    candidate: unknown,
  ): Promise<
    Result<BackupRestoreAssessment, RecoveryAssessmentError | FoundationError>
  >;
  commit(
    command: BackupRestoreCommitCommand,
  ): Promise<Result<BackupRestoreCommitOutcome, FoundationError>>;
  findPendingFinalization(): Promise<
    Result<BackupRestoreFinalizationTicket | null, FoundationError>
  >;
  finalize(
    ticket: BackupRestoreFinalizationTicket,
  ): Promise<Result<BackupRestoreCommitReceipt, FoundationError>>;
}

export interface WriteAuthorityDependencies {
  readonly repository: LocalDataRepository;
  readonly runner: RootTransactionRunner;
  readonly pipeline: MutationPipeline;
}

const pipelineFailure = (code: string): FoundationError => {
  switch (code) {
    case "quota-exceeded":
      return { code: "quota-exceeded" };
    case "repair-failed":
      return { code: "repair-failed" };
    default:
      return { code: "validation" };
  }
};

class WriteQueue {
  #tail: Promise<void> = Promise.resolve();

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const pending = this.#tail.then(task, task);
    this.#tail = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }
}

class DefaultWriteAuthority implements FoundationDataPort {
  readonly #deps: WriteAuthorityDependencies;
  readonly #queue = new WriteQueue();

  constructor(deps: WriteAuthorityDependencies) {
    this.#deps = deps;
  }

  async query<T>(query: RootQuery<T>): Promise<Result<T, FoundationError>> {
    const result = await this.#deps.repository.query(query);
    return result as Result<T, RepositoryError>;
  }

  mutate(
    command: RootMutationCommand,
  ): Promise<Result<MutationReceipt, FoundationError>> {
    return this.#queue.enqueue(() =>
      this.#deps.runner.runRequest({
        requestId: command.requestId,
        payload: {
          expectedRevision: command.expectedRevision,
          operation: command.operation,
          ...(command.maintenance === undefined
            ? {}
            : { maintenance: command.maintenance }),
        } as unknown as RequestPayload,
        expectedRevision: command.expectedRevision,
        ...(command.maintenance === undefined
          ? {}
          : { maintenance: command.maintenance }),
        execute: ({ snapshot, currentBytes, quotaBytes }) => {
          const candidate = this.#deps.pipeline.apply(
            snapshot,
            command.operation,
            { currentBytes, quotaBytes },
          );
          if (!candidate.ok)
            return {
              ok: false,
              error: pipelineFailure(candidate.error.code),
            };
          return {
            ok: true,
            value: {
              root: candidate.value.root,
              value: { capacity: candidate.value.capacity },
            },
          };
        },
      }),
    );
  }

  assessReplacement(
    input: unknown,
  ): Promise<Result<ReplacementAssessment, FoundationError>> {
    return this.#queue.enqueue(() =>
      this.#deps.runner.assessReplacement(input),
    );
  }

  replaceRoot(
    command: ReplacementCommand,
  ): Promise<Result<ReplacementReceipt, FoundationError>> {
    return this.#queue.enqueue(() => this.#deps.runner.replaceRoot(command));
  }

  runMaintenance(
    command: MaintenanceCommand,
  ): Promise<Result<MaintenanceReceipt, FoundationError>> {
    return this.#queue.enqueue(() => this.#deps.runner.runMaintenance(command));
  }
}

export const createWriteAuthority = (
  dependencies: WriteAuthorityDependencies,
): FoundationDataPort => new DefaultWriteAuthority(dependencies);

export const createBackupRestoreDataPort = (
  runner: RootTransactionRunner,
): BackupRestoreDataPort => {
  type StoredAssessment =
    | { readonly mode: "normal"; readonly value: ReplacementAssessment }
    | { readonly mode: "recovery"; readonly value: RecoveryAssessment };
  const assessments = new Map<
    BackupRestoreAssessmentTicket,
    StoredAssessment
  >();
  const finalizations = new Map<
    BackupRestoreFinalizationTicket,
    RecoveryFinalizationCommand
  >();
  const newAssessmentTicket = (): BackupRestoreAssessmentTicket =>
    globalThis.crypto.randomUUID() as BackupRestoreAssessmentTicket;
  const newFinalizationTicket = (): BackupRestoreFinalizationTicket =>
    globalThis.crypto.randomUUID() as BackupRestoreFinalizationTicket;
  const assessmentIdentity = (assessment: StoredAssessment): string =>
    assessment.mode === "normal"
      ? assessment.value.token
      : [
          assessment.value.cursor.current.fingerprint,
          assessment.value.cursor.candidateDigest,
          assessment.value.cursor.targetSchemaVersion,
          assessment.value.cursor.requiredBytes,
        ].join(":");
  const completeCommittedRoot = async (
    receipt: BackupRestoreCommitReceipt,
    ticket: BackupRestoreFinalizationTicket,
  ): Promise<Result<BackupRestoreCommitOutcome, FoundationError>> => {
    const pending = await runner.findPendingRecoveryFinalization();
    if (pending.ok && pending.value !== null) {
      finalizations.set(ticket, pending.value);
      const finalized = await runner.finalizeRecovery(pending.value);
      if (finalized.ok) {
        finalizations.delete(ticket);
        return {
          ok: true,
          value: { kind: "committed", receipt },
        };
      }
    }
    return {
      ok: true,
      value: {
        kind: "committed-finalization-required",
        receipt,
        finalization: ticket,
      },
    };
  };

  return Object.freeze({
    async assessReplacement(input: unknown) {
      const assessed = await runner.assessReplacement(input);
      if (!assessed.ok) return assessed;
      const ticket = newAssessmentTicket();
      assessments.set(ticket, { mode: "normal", value: assessed.value });
      return {
        ok: true as const,
        value: {
          mode: "normal" as const,
          requiredBytes: assessed.value.requiredBytes,
          ticket,
        },
      };
    },
    async assessRecovery(candidate: unknown) {
      const assessed = await runner.assessRecovery(candidate);
      if (!assessed.ok) return assessed;
      const ticket = newAssessmentTicket();
      assessments.set(ticket, { mode: "recovery", value: assessed.value });
      const current = assessed.value.cursor.current;
      return {
        ok: true as const,
        value: {
          mode: "recovery" as const,
          requiredBytes: assessed.value.requiredBytes,
          currentAnomaly:
            current.code === "unsupported-version"
              ? { code: current.code, version: current.version }
              : { code: current.code },
          ticket,
        },
      };
    },
    async commit(command: BackupRestoreCommitCommand) {
      let stored = assessments.get(command.assessment);
      if (stored !== undefined && stored.mode !== command.expectedMode)
        return {
          ok: false as const,
          error: { code: "stale-assessment" as const },
        };
      if (stored === undefined) {
        const cleaned = await runner.cleanupPendingRecovery(command.assessment);
        if (!cleaned.ok) return cleaned;
        if (cleaned.value.mode !== command.expectedMode)
          return {
            ok: false as const,
            error: { code: "stale-assessment" as const },
          };
        if (command.expectedMode === "recovery") {
          const reassessed = await runner.assessRecovery(command.candidate);
          if (!reassessed.ok)
            return {
              ok: false as const,
              error: { code: "stale-assessment" as const },
            };
          stored = { mode: "recovery", value: reassessed.value };
        } else {
          const reassessed = await runner.assessReplacement(command.candidate);
          if (!reassessed.ok) return reassessed;
          stored = { mode: "normal", value: reassessed.value };
        }
        if (assessmentIdentity(stored) !== cleaned.value.assessmentIdentity)
          return {
            ok: false as const,
            error: { code: "stale-assessment" as const },
          };
      }
      assessments.delete(command.assessment);

      if (stored.mode === "recovery") {
        const acquired = await runner.runRecoveryMaintenance({
          type: "acquire",
          ownerId: globalThis.crypto.randomUUID(),
          leaseMs: 30_000,
          assessmentTicketId: command.assessment,
          assessmentIdentity: assessmentIdentity(stored),
          commitMode: stored.mode,
        });
        if (!acquired.ok) return acquired;
        const fence = acquired.value.fence;
        if (fence === undefined)
          return {
            ok: false as const,
            error: { code: "storage-unavailable" as const },
          };
        const finalizationId = newFinalizationTicket();
        const replaced = await runner.replaceFromRecovery({
          candidate: command.candidate,
          assessment: stored.value,
          fence,
          finalizationTicketId: finalizationId,
        });
        if (!replaced.ok) {
          const aborted = await runner.runRecoveryMaintenance({
            type: "abort",
            fence,
          });
          return aborted.ok
            ? replaced
            : {
                ok: false as const,
                error: { code: "precommit-cleanup-pending" as const },
              };
        }
        const receipt: BackupRestoreCommitReceipt = {
          mode: "recovery",
          revision: replaced.value.revision,
        };
        return completeCommittedRoot(receipt, finalizationId);
      }

      const currentAssessment = await runner.assessReplacement(
        command.candidate,
      );
      if (!currentAssessment.ok) return currentAssessment;
      if (currentAssessment.value.token !== stored.value.token)
        return {
          ok: false as const,
          error: { code: "stale-assessment" as const },
        };
      const acquired = await runner.runRecoveryMaintenance({
        type: "acquire",
        ownerId: globalThis.crypto.randomUUID(),
        leaseMs: 30_000,
        assessmentTicketId: command.assessment,
        assessmentIdentity: assessmentIdentity(stored),
        commitMode: stored.mode,
      });
      if (!acquired.ok) return acquired;
      const fence = acquired.value.fence;
      if (fence === undefined)
        return {
          ok: false as const,
          error: { code: "storage-unavailable" as const },
        };
      const finalizationId = newFinalizationTicket();
      const replaced = await runner.replaceRootUnderRecoveryControl({
        candidate: command.candidate,
        assessment: stored.value,
        fence,
        finalizationTicketId: finalizationId,
      });
      if (!replaced.ok) {
        const cleaned = await runner.cleanupPendingRecovery(command.assessment);
        return cleaned.ok ? replaced : cleaned;
      }
      return completeCommittedRoot(
        { mode: "normal", revision: replaced.value.revision },
        finalizationId,
      );
    },
    async findPendingFinalization() {
      const pending = await runner.findPendingRecoveryFinalization();
      if (!pending.ok) return pending;
      if (pending.value === null) return { ok: true as const, value: null };
      const ticket = (pending.value.ticketId ??
        newFinalizationTicket()) as BackupRestoreFinalizationTicket;
      finalizations.set(ticket, pending.value);
      return { ok: true as const, value: ticket };
    },
    async finalize(ticket: BackupRestoreFinalizationTicket) {
      const command = finalizations.get(ticket);
      let resolved = command;
      if (resolved === undefined) {
        const pending = await runner.findPendingRecoveryFinalization();
        if (!pending.ok) return pending;
        if (pending.value === null || pending.value.ticketId !== ticket)
          return {
            ok: false as const,
            error: { code: "stale-assessment" as const },
          };
        resolved = pending.value;
      }
      const finalized = await runner.finalizeRecovery(resolved);
      if (!finalized.ok) return finalized;
      finalizations.delete(ticket);
      return {
        ok: true as const,
        value: {
          mode: resolved.mode ?? "recovery",
          revision: finalized.value.revision,
        },
      };
    },
  });
};

/**
 * 同一contextのauthorityへ委譲するfrozen view。
 * 排他の根拠は固定名Web Lockと永続rootのrevisionであり、view追加では変わらない。
 */
export const createScopedDataPort = (
  port: FoundationScopedDataPort,
): FoundationScopedDataPort =>
  Object.freeze({
    query: <T>(query: RootQuery<T>) => port.query(query),
    mutate: (command: RootMutationCommand) => port.mutate(command),
  });
