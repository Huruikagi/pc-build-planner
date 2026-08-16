import type {
  RequestId,
  Revision,
  UtcTimestamp,
} from "../domain/identifiers.js";
import type { LocalDataRoot, MaintenanceOwnerId } from "../domain/model.js";
import type { FoundationError, Result } from "../domain/result.js";
import type { SchemaValidator } from "../domain/validation.js";
import {
  currentRootStorageBytes,
  serializedLocalDataStorageBytes,
} from "./capacity-policy.js";
import type {
  MaintenanceFence,
  MaintenancePolicy,
  MaintenanceTransition,
} from "./maintenance.js";
import type {
  MigrationError,
  MigrationRegistry,
} from "./migration-registry.js";
import type {
  RecoveryAssessment,
  RecoveryAssessmentError,
  RecoveryCoordinator,
} from "./recovery.js";
import {
  type RecoveryControlError,
  type RecoveryFence,
  recoveryControlPolicy,
  validateRecoveryControl,
} from "./recovery-control.js";
import type {
  ReplacementAssessment,
  ReplacementError,
  ReplacementEvaluator,
} from "./replacement.js";
import { canonicalJson } from "./replacement.js";
import type { StoragePort } from "./repository.js";
import type { RootWriteLock } from "./root-write-lock.js";
import { REQUEST_DEDUPE_LIMIT } from "./schema.js";

export type RequestPayload =
  | null
  | boolean
  | number
  | string
  | readonly RequestPayload[]
  | { readonly [key: string]: RequestPayload };

const compareCodePoints = (left: string, right: string): number => {
  const leftPoints = Array.from(
    left,
    (value) => value.codePointAt(0) as number,
  );
  const rightPoints = Array.from(
    right,
    (value) => value.codePointAt(0) as number,
  );
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference =
      (leftPoints[index] as number) - (rightPoints[index] as number);
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
};

const canonicalizeRequest = (value: RequestPayload): RequestPayload => {
  if (Array.isArray(value)) return value.map(canonicalizeRequest);
  if (value !== null && typeof value === "object") {
    const record = value as { readonly [key: string]: RequestPayload };
    const sorted: Record<string, RequestPayload> = {};
    for (const key of Object.keys(record).sort(compareCodePoints))
      sorted[key] = canonicalizeRequest(record[key] as RequestPayload);
    return sorted;
  }
  return value;
};

const requestPayloadDigest = async (value: RequestPayload): Promise<string> => {
  const bytes = new TextEncoder().encode(
    JSON.stringify(canonicalizeRequest(value)),
  );
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
};

export interface RootTransactionContext {
  readonly snapshot: LocalDataRoot;
  readonly currentBytes: number;
  readonly currentRootBytes: number;
  readonly quotaBytes: number;
}

export interface RootTransactionCandidate<T> {
  /** revision増分前の、完全な保存候補。 */
  readonly root: LocalDataRoot;
  /** commit成功後にだけ呼び出し元へ返す値。 */
  readonly value: T;
}

export interface RootTransactionOperation<T> {
  readonly expectedRevision: Revision;
  readonly maintenance?: MaintenanceFence;
  execute(
    context: RootTransactionContext,
  ):
    | Result<RootTransactionCandidate<T>, FoundationError>
    | Promise<Result<RootTransactionCandidate<T>, FoundationError>>;
}

export interface RequestRootTransactionOperation<T>
  extends RootTransactionOperation<T> {
  readonly requestId: RequestId;
  /** JSON直列化可能なcommand payload。object key順はdigestへ影響しない。 */
  readonly payload: RequestPayload;
}

export interface RequestCommitReceipt<T> {
  readonly committedRevision: Revision;
  readonly replayed: boolean;
  /** 初回commit時だけ利用可能。再試行の安定したreceiptはrevisionである。 */
  readonly value?: T;
}

export interface RootTransactionRunner {
  run<T>(
    operation: RootTransactionOperation<T>,
  ): Promise<Result<T, FoundationError>>;
  runRequest<T>(
    operation: RequestRootTransactionOperation<T>,
  ): Promise<Result<RequestCommitReceipt<T>, FoundationError>>;
  runMaintenance(
    command: MaintenanceCommand,
  ): Promise<Result<MaintenanceReceipt, FoundationError>>;
  runRecoveryMaintenance(
    command: RecoveryMaintenanceCommand,
  ): Promise<Result<RecoveryMaintenanceReceipt, FoundationError>>;
  assessReplacement(
    candidate: unknown,
  ): Promise<Result<ReplacementAssessment, FoundationError>>;
  assessRecovery(
    candidate: unknown,
  ): Promise<
    Result<RecoveryAssessment, RecoveryAssessmentError | FoundationError>
  >;
  replaceRoot(
    command: ReplacementCommand,
  ): Promise<Result<ReplacementReceipt, FoundationError>>;
  replaceFromRecovery(
    command: RecoveryReplacementCommand,
  ): Promise<Result<ReplacementReceipt, FoundationError>>;
  replaceRootUnderRecoveryControl(
    command: ControlledReplacementCommand,
  ): Promise<Result<ReplacementReceipt, FoundationError>>;
  findPendingRecoveryFinalization(): Promise<
    Result<RecoveryFinalizationCommand | null, FoundationError>
  >;
  finalizeRecovery(
    command: RecoveryFinalizationCommand,
  ): Promise<Result<{ readonly revision: Revision }, FoundationError>>;
  cleanupPendingRecovery(
    assessmentTicketId: string,
  ): Promise<Result<RecoveryCleanupResume, FoundationError>>;
}

export interface RecoveryCleanupResume {
  readonly assessmentIdentity: string;
  readonly mode: "normal" | "recovery";
}

export interface ReplacementCommand {
  readonly candidate: unknown;
  readonly assessment: ReplacementAssessment;
  readonly fence: MaintenanceFence;
}

export interface ReplacementReceipt {
  readonly revision: Revision;
  readonly beforeBytes: number;
  readonly afterBytes: number;
}

export type MaintenanceCommand =
  | {
      readonly type: "acquire";
      readonly ownerId: MaintenanceOwnerId;
      readonly leaseMs: number;
    }
  | {
      readonly type: "renew";
      readonly fence: MaintenanceFence;
      readonly leaseMs: number;
    }
  | {
      readonly type: "release" | "abort";
      readonly fence: MaintenanceFence;
    };

export interface MaintenanceReceipt {
  readonly fence?: MaintenanceFence;
}

export type RecoveryMaintenanceCommand =
  | {
      readonly type: "acquire";
      readonly ownerId: string;
      readonly leaseMs: number;
      readonly assessmentTicketId?: string;
      readonly assessmentIdentity?: string;
      readonly commitMode?: "normal" | "recovery";
    }
  | {
      readonly type: "renew";
      readonly fence: RecoveryFence;
      readonly leaseMs: number;
    }
  | {
      readonly type: "release" | "abort";
      readonly fence: RecoveryFence;
    };

export interface RecoveryMaintenanceReceipt {
  readonly fence?: RecoveryFence;
}

export interface RecoveryReplacementCommand {
  readonly candidate: unknown;
  readonly assessment: RecoveryAssessment;
  readonly fence: RecoveryFence;
  readonly finalizationTicketId?: string;
}

export interface ControlledReplacementCommand {
  readonly candidate: unknown;
  readonly assessment: ReplacementAssessment;
  readonly fence: RecoveryFence;
  readonly finalizationTicketId: string;
}

export interface RecoveryFinalizationCommand {
  readonly fence: RecoveryFence;
  readonly candidateDigest: string;
  readonly revision: Revision;
  readonly ticketId?: string;
  readonly mode?: "normal" | "recovery";
}

export interface RootTransactionRunnerDependencies {
  readonly storage: StoragePort;
  readonly lock: RootWriteLock;
  readonly migrations: MigrationRegistry;
  readonly validator: SchemaValidator;
  readonly maintenance: MaintenancePolicy;
  readonly replacement?: ReplacementEvaluator;
  readonly recovery?: RecoveryCoordinator;
  readonly now: () => UtcTimestamp;
  readonly initialRoot: () => LocalDataRoot;
}

const migrationFailure = (error: MigrationError): FoundationError => {
  switch (error.code) {
    case "unsupported-version":
      return { code: "unsupported-version" };
    case "validation":
      return { code: "corrupt-data" };
    case "migration-path-missing":
    case "migration-failed":
      return { code: "migration-failed" };
  }
};

const replacementFailure = (error: ReplacementError): FoundationError => {
  switch (error.code) {
    case "quota-exceeded":
      return { code: "quota-exceeded" };
    case "stale-assessment":
      return { code: "stale-assessment" };
    case "unsupported-version":
      return { code: "unsupported-version" };
    case "migration-path-missing":
    case "migration-failed":
      return { code: "migration-failed" };
    case "validation":
    case "invalid-capacity-input":
      return { code: "validation" };
  }
};

const recoveryControlFailure = (
  error: RecoveryControlError,
): FoundationError => {
  switch (error.code) {
    case "recovery-active":
    case "stale-recovery-state":
      return { code: error.code };
    case "invalid-recovery-control":
      return { code: "corrupt-data" };
  }
};

const leaseExpiresAt = (
  now: UtcTimestamp,
  leaseMs: number,
): Result<string, FoundationError> => {
  if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0)
    return { ok: false, error: { code: "validation" } };
  const milliseconds = Date.parse(now) + leaseMs;
  if (!Number.isFinite(milliseconds))
    return { ok: false, error: { code: "validation" } };
  return { ok: true, value: new Date(milliseconds).toISOString() };
};

const digestRoot = async (root: LocalDataRoot): Promise<string> => {
  const bytes = new TextEncoder().encode(canonicalJson(root as never));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
};

const nextRevision = (revision: Revision): Revision | undefined => {
  const next = revision + 1;
  return Number.isSafeInteger(next) ? (next as Revision) : undefined;
};

class DefaultRootTransactionRunner implements RootTransactionRunner {
  readonly #deps: RootTransactionRunnerDependencies;

  constructor(deps: RootTransactionRunnerDependencies) {
    this.#deps = deps;
  }

  async run<T>(
    operation: RootTransactionOperation<T>,
  ): Promise<Result<T, FoundationError>> {
    let locked: Awaited<ReturnType<RootWriteLock["runExclusive"]>>;
    try {
      locked = await this.#deps.lock.runExclusive(async () =>
        this.#runLocked(operation),
      );
    } catch {
      return { ok: false, error: { code: "lock-unavailable" } };
    }
    if (!locked.ok) return locked;
    return locked.value as Result<T, FoundationError>;
  }

  async runRequest<T>(
    operation: RequestRootTransactionOperation<T>,
  ): Promise<Result<RequestCommitReceipt<T>, FoundationError>> {
    let locked: Awaited<ReturnType<RootWriteLock["runExclusive"]>>;
    try {
      locked = await this.#deps.lock.runExclusive(async () =>
        this.#runRequestLocked(operation),
      );
    } catch {
      return { ok: false, error: { code: "lock-unavailable" } };
    }
    if (!locked.ok) return locked;
    return locked.value as Result<RequestCommitReceipt<T>, FoundationError>;
  }

  async runMaintenance(
    command: MaintenanceCommand,
  ): Promise<Result<MaintenanceReceipt, FoundationError>> {
    let locked: Awaited<ReturnType<RootWriteLock["runExclusive"]>>;
    try {
      locked = await this.#deps.lock.runExclusive(async () =>
        this.#runMaintenanceLocked(command),
      );
    } catch {
      return { ok: false, error: { code: "lock-unavailable" } };
    }
    if (!locked.ok) return locked;
    return locked.value as Result<MaintenanceReceipt, FoundationError>;
  }

  async runRecoveryMaintenance(
    command: RecoveryMaintenanceCommand,
  ): Promise<Result<RecoveryMaintenanceReceipt, FoundationError>> {
    let locked: Awaited<ReturnType<RootWriteLock["runExclusive"]>>;
    try {
      locked = await this.#deps.lock.runExclusive(async () =>
        this.#runRecoveryMaintenanceLocked(command),
      );
    } catch {
      return { ok: false, error: { code: "lock-unavailable" } };
    }
    if (!locked.ok) return locked;
    return locked.value as Result<RecoveryMaintenanceReceipt, FoundationError>;
  }

  async replaceRoot(
    command: ReplacementCommand,
  ): Promise<Result<ReplacementReceipt, FoundationError>> {
    let locked: Awaited<ReturnType<RootWriteLock["runExclusive"]>>;
    try {
      locked = await this.#deps.lock.runExclusive(async () =>
        this.#replaceRootLocked(command),
      );
    } catch {
      return { ok: false, error: { code: "lock-unavailable" } };
    }
    if (!locked.ok) return locked;
    return locked.value as Result<ReplacementReceipt, FoundationError>;
  }

  async assessReplacement(
    candidate: unknown,
  ): Promise<Result<ReplacementAssessment, FoundationError>> {
    let locked: Awaited<ReturnType<RootWriteLock["runExclusive"]>>;
    try {
      locked = await this.#deps.lock.runExclusive(async () =>
        this.#assessReplacementLocked(candidate),
      );
    } catch {
      return { ok: false, error: { code: "lock-unavailable" } };
    }
    if (!locked.ok) return locked;
    return locked.value as Result<ReplacementAssessment, FoundationError>;
  }

  async assessRecovery(
    candidate: unknown,
  ): Promise<
    Result<RecoveryAssessment, RecoveryAssessmentError | FoundationError>
  > {
    let locked: Awaited<ReturnType<RootWriteLock["runExclusive"]>>;
    try {
      locked = await this.#deps.lock.runExclusive(async () => {
        const recovery = this.#deps.recovery;
        return recovery === undefined
          ? { ok: false, error: { code: "validation" } }
          : recovery.assessRecovery(candidate);
      });
    } catch {
      return { ok: false, error: { code: "lock-unavailable" } };
    }
    if (!locked.ok) return locked;
    return locked.value as Result<
      RecoveryAssessment,
      RecoveryAssessmentError | FoundationError
    >;
  }

  async replaceFromRecovery(
    command: RecoveryReplacementCommand,
  ): Promise<Result<ReplacementReceipt, FoundationError>> {
    let locked: Awaited<ReturnType<RootWriteLock["runExclusive"]>>;
    try {
      locked = await this.#deps.lock.runExclusive(async () =>
        this.#replaceFromRecoveryLocked(command),
      );
    } catch {
      return { ok: false, error: { code: "lock-unavailable" } };
    }
    if (!locked.ok) return locked;
    return locked.value as Result<ReplacementReceipt, FoundationError>;
  }

  async replaceRootUnderRecoveryControl(
    command: ControlledReplacementCommand,
  ): Promise<Result<ReplacementReceipt, FoundationError>> {
    let locked: Awaited<ReturnType<RootWriteLock["runExclusive"]>>;
    try {
      locked = await this.#deps.lock.runExclusive(async () =>
        this.#replaceRootUnderRecoveryControlLocked(command),
      );
    } catch {
      return { ok: false, error: { code: "lock-unavailable" } };
    }
    if (!locked.ok) return locked;
    return locked.value as Result<ReplacementReceipt, FoundationError>;
  }

  async findPendingRecoveryFinalization(): Promise<
    Result<RecoveryFinalizationCommand | null, FoundationError>
  > {
    let locked: Awaited<ReturnType<RootWriteLock["runExclusive"]>>;
    try {
      locked = await this.#deps.lock.runExclusive(async () =>
        this.#findPendingRecoveryFinalizationLocked(),
      );
    } catch {
      return { ok: false, error: { code: "lock-unavailable" } };
    }
    if (!locked.ok) return locked;
    return locked.value as Result<
      RecoveryFinalizationCommand | null,
      FoundationError
    >;
  }

  async finalizeRecovery(
    command: RecoveryFinalizationCommand,
  ): Promise<Result<{ readonly revision: Revision }, FoundationError>> {
    let locked: Awaited<ReturnType<RootWriteLock["runExclusive"]>>;
    try {
      locked = await this.#deps.lock.runExclusive(async () =>
        this.#finalizeRecoveryLocked(command),
      );
    } catch {
      return { ok: false, error: { code: "lock-unavailable" } };
    }
    if (!locked.ok) return locked;
    return locked.value as Result<
      { readonly revision: Revision },
      FoundationError
    >;
  }

  async cleanupPendingRecovery(
    assessmentTicketId: string,
  ): Promise<Result<RecoveryCleanupResume, FoundationError>> {
    let locked: Awaited<ReturnType<RootWriteLock["runExclusive"]>>;
    try {
      locked = await this.#deps.lock.runExclusive(async () =>
        this.#cleanupPendingRecoveryLocked(assessmentTicketId),
      );
    } catch {
      return { ok: false, error: { code: "lock-unavailable" } };
    }
    if (!locked.ok) return locked;
    return locked.value as Result<RecoveryCleanupResume, FoundationError>;
  }

  async #assessReplacementLocked(
    candidate: unknown,
  ): Promise<Result<ReplacementAssessment, FoundationError>> {
    const current = await this.#readCurrentRoot();
    if (!current.ok) return current;
    const bytes = await this.#deps.storage.bytesInUse();
    if (!bytes.ok) return bytes;
    let quotaBytes: number;
    try {
      quotaBytes = this.#deps.storage.quotaBytes();
    } catch {
      return { ok: false, error: { code: "storage-unavailable" } };
    }
    const replacement = this.#deps.replacement;
    if (replacement === undefined)
      return { ok: false, error: { code: "validation" } };
    const assessed = await replacement.assessReplacement(candidate, {
      currentBytes: bytes.value,
      currentRootBytes: currentRootStorageBytes(bytes.value, current.value),
      quotaBytes,
      revision: current.value.revision,
      maintenance: current.value.maintenance,
    });
    return assessed.ok
      ? assessed
      : { ok: false, error: replacementFailure(assessed.error) };
  }

  async #replaceRootLocked(
    command: ReplacementCommand,
  ): Promise<Result<ReplacementReceipt, FoundationError>> {
    const current = await this.#readCurrentRoot();
    if (!current.ok) return current;
    const recoveryAuthorized = await this.#authorizeNormalWrite();
    if (!recoveryAuthorized.ok) return recoveryAuthorized;
    const snapshot = current.value;
    const bytes = await this.#deps.storage.bytesInUse();
    if (!bytes.ok) return bytes;
    let quotaBytes: number;
    try {
      quotaBytes = this.#deps.storage.quotaBytes();
    } catch {
      return { ok: false, error: { code: "storage-unavailable" } };
    }

    if (command.assessment.cursor.revision !== snapshot.revision)
      return { ok: false, error: { code: "stale-assessment" } };
    const authorized = this.#deps.maintenance.authorizeWrite(
      snapshot,
      command.fence,
      this.#deps.now(),
    );
    if (!authorized.ok) return authorized;
    const replacement = this.#deps.replacement;
    if (replacement === undefined)
      return { ok: false, error: { code: "validation" } };
    const verified = await replacement.verifyReplacement(
      command.candidate,
      command.assessment,
      {
        currentBytes: bytes.value,
        currentRootBytes: currentRootStorageBytes(bytes.value, snapshot),
        quotaBytes,
        revision: snapshot.revision,
        maintenance: snapshot.maintenance,
      },
    );
    if (!verified.ok)
      return { ok: false, error: replacementFailure(verified.error) };
    const revision = nextRevision(snapshot.revision);
    if (revision === undefined)
      return { ok: false, error: { code: "corrupt-data" } };
    if (verified.value.revision !== revision)
      return { ok: false, error: { code: "stale-assessment" } };
    const validated = this.#deps.validator.validateRoot(verified.value);
    if (!validated.ok) return { ok: false, error: { code: "validation" } };
    const committed = await this.#deps.storage.writeRoot(validated.value);
    return committed.ok
      ? {
          ok: true,
          value: {
            revision,
            beforeBytes: bytes.value,
            afterBytes: command.assessment.requiredBytes,
          },
        }
      : committed;
  }

  async #replaceFromRecoveryLocked(
    command: RecoveryReplacementCommand,
  ): Promise<Result<ReplacementReceipt, FoundationError>> {
    const recovery = this.#deps.recovery;
    const replacement = this.#deps.replacement;
    if (recovery === undefined || replacement === undefined)
      return { ok: false, error: { code: "validation" } };
    const storedControl = await this.#deps.storage.readRecoveryControl();
    if (!storedControl.ok) return storedControl;
    const control = validateRecoveryControl(storedControl.value);
    if (!control.ok) return { ok: false, error: { code: "corrupt-data" } };
    const authorized = recoveryControlPolicy.authorizeRecovery(
      control.value,
      command.fence,
      this.#deps.now(),
    );
    if (!authorized.ok)
      return { ok: false, error: recoveryControlFailure(authorized.error) };
    if (
      command.assessment.cursor.controlGeneration + 1 !==
      command.fence.generation
    )
      return { ok: false, error: { code: "stale-assessment" } };

    const verifiedAssessment = await recovery.verifyRecovery(
      command.candidate,
      command.assessment,
    );
    if (!verifiedAssessment.ok) return verifiedAssessment;
    const rawRoot = await this.#deps.storage.readRoot();
    if (!rawRoot.ok) return rawRoot;
    if (rawRoot.value === undefined)
      return { ok: false, error: { code: "corrupt-data" } };
    const bytes = await this.#deps.storage.bytesInUse();
    if (!bytes.ok) return bytes;
    let quotaBytes: number;
    try {
      quotaBytes = this.#deps.storage.quotaBytes();
    } catch {
      return { ok: false, error: { code: "storage-unavailable" } };
    }
    const candidate = await replacement.verifyReplacement(
      command.candidate,
      verifiedAssessment.value,
      {
        currentBytes: bytes.value,
        currentRootBytes: currentRootStorageBytes(bytes.value, rawRoot.value),
        quotaBytes,
        revision: 0,
        maintenance: { generation: 0 as never, active: false },
      },
    );
    if (!candidate.ok)
      return { ok: false, error: replacementFailure(candidate.error) };
    const bound = recoveryControlPolicy.bindCommit(
      control.value,
      command.fence,
      verifiedAssessment.value.candidateDigest,
      candidate.value.revision,
      this.#deps.now(),
      command.finalizationTicketId,
      "recovery",
    );
    if (!bound.ok)
      return { ok: false, error: recoveryControlFailure(bound.error) };
    let commitBytes: number;
    try {
      commitBytes = serializedLocalDataStorageBytes(
        candidate.value,
        bound.value,
      );
    } catch {
      return { ok: false, error: { code: "validation" } };
    }
    if (commitBytes > quotaBytes)
      return { ok: false, error: { code: "quota-exceeded" } };
    const controlCommitted = await this.#deps.storage.writeRecoveryControl(
      bound.value,
    );
    if (!controlCommitted.ok) return controlCommitted;
    const committed = await this.#deps.storage.writeRoot(candidate.value);
    return committed.ok
      ? {
          ok: true,
          value: {
            revision: candidate.value.revision,
            beforeBytes: bytes.value,
            afterBytes: commitBytes,
          },
        }
      : committed;
  }

  async #findPendingRecoveryFinalizationLocked(): Promise<
    Result<RecoveryFinalizationCommand | null, FoundationError>
  > {
    const stored = await this.#deps.storage.readRecoveryControl();
    if (!stored.ok) return stored;
    const control = validateRecoveryControl(stored.value);
    if (!control.ok) return { ok: false, error: { code: "corrupt-data" } };
    if (
      !control.value.active ||
      control.value.candidateDigest === undefined ||
      control.value.expectedCommitRevision === undefined
    )
      return { ok: true, value: null };
    const current = await this.#readCurrentRoot();
    if (!current.ok) return { ok: true, value: null };
    if (
      current.value.revision !== control.value.expectedCommitRevision ||
      (await digestRoot(current.value)) !== control.value.candidateDigest
    )
      return { ok: true, value: null };
    return {
      ok: true,
      value: {
        fence: {
          generation: control.value.generation,
          ownerId: control.value.ownerId as string,
          leaseExpiresAt: control.value.leaseExpiresAt as string,
        },
        candidateDigest: control.value.candidateDigest,
        revision: current.value.revision,
        ...(control.value.finalizationTicketId === undefined
          ? {}
          : { ticketId: control.value.finalizationTicketId }),
        mode: control.value.commitMode ?? "recovery",
      },
    };
  }

  async #finalizeRecoveryLocked(
    command: RecoveryFinalizationCommand,
  ): Promise<Result<{ readonly revision: Revision }, FoundationError>> {
    const stored = await this.#deps.storage.readRecoveryControl();
    if (!stored.ok) return stored;
    const control = validateRecoveryControl(stored.value);
    if (!control.ok) return { ok: false, error: { code: "corrupt-data" } };
    const authorized = recoveryControlPolicy.authorizeRecovery(
      control.value,
      command.fence,
    );
    if (!authorized.ok)
      return { ok: false, error: recoveryControlFailure(authorized.error) };
    if (
      (command.ticketId !== undefined &&
        control.value.finalizationTicketId !== command.ticketId) ||
      (command.mode !== undefined &&
        (control.value.commitMode ?? "recovery") !== command.mode) ||
      control.value.candidateDigest !== command.candidateDigest ||
      control.value.expectedCommitRevision !== command.revision
    )
      return { ok: false, error: { code: "stale-assessment" } };
    const current = await this.#readCurrentRoot();
    if (!current.ok) return current;
    if (
      current.value.revision !== command.revision ||
      (await digestRoot(current.value)) !== command.candidateDigest
    )
      return { ok: false, error: { code: "stale-assessment" } };
    const released = recoveryControlPolicy.release(
      control.value,
      command.fence,
    );
    if (!released.ok)
      return { ok: false, error: recoveryControlFailure(released.error) };
    const committed = await this.#deps.storage.writeRecoveryControl(
      released.value,
    );
    return committed.ok
      ? { ok: true, value: { revision: command.revision } }
      : committed;
  }

  async #replaceRootUnderRecoveryControlLocked(
    command: ControlledReplacementCommand,
  ): Promise<Result<ReplacementReceipt, FoundationError>> {
    const replacement = this.#deps.replacement;
    if (replacement === undefined)
      return { ok: false, error: { code: "validation" } };
    const current = await this.#readCurrentRoot();
    if (!current.ok) return current;
    const maintenanceAuthorized = this.#deps.maintenance.authorizeWrite(
      current.value,
      undefined,
      this.#deps.now(),
    );
    if (!maintenanceAuthorized.ok) return maintenanceAuthorized;
    const storedControl = await this.#deps.storage.readRecoveryControl();
    if (!storedControl.ok) return storedControl;
    const control = validateRecoveryControl(storedControl.value);
    if (!control.ok) return { ok: false, error: { code: "corrupt-data" } };
    const authorized = recoveryControlPolicy.authorizeRecovery(
      control.value,
      command.fence,
      this.#deps.now(),
    );
    if (!authorized.ok)
      return { ok: false, error: recoveryControlFailure(authorized.error) };
    const bytes = await this.#deps.storage.bytesInUse();
    if (!bytes.ok) return bytes;
    let quotaBytes: number;
    try {
      quotaBytes = this.#deps.storage.quotaBytes();
    } catch {
      return { ok: false, error: { code: "storage-unavailable" } };
    }
    const candidate = await replacement.verifyReplacement(
      command.candidate,
      command.assessment,
      {
        currentBytes: bytes.value,
        currentRootBytes: currentRootStorageBytes(bytes.value, current.value),
        quotaBytes,
        revision: current.value.revision,
        maintenance: current.value.maintenance,
      },
    );
    if (!candidate.ok)
      return { ok: false, error: replacementFailure(candidate.error) };
    const bound = recoveryControlPolicy.bindCommit(
      control.value,
      command.fence,
      command.assessment.candidateDigest,
      candidate.value.revision,
      this.#deps.now(),
      command.finalizationTicketId,
      "normal",
    );
    if (!bound.ok)
      return { ok: false, error: recoveryControlFailure(bound.error) };
    let commitBytes: number;
    try {
      commitBytes = serializedLocalDataStorageBytes(
        candidate.value,
        bound.value,
      );
    } catch {
      return { ok: false, error: { code: "validation" } };
    }
    if (commitBytes > quotaBytes)
      return { ok: false, error: { code: "quota-exceeded" } };
    const controlCommitted = await this.#deps.storage.writeRecoveryControl(
      bound.value,
    );
    if (!controlCommitted.ok) return controlCommitted;
    const committed = await this.#deps.storage.writeRoot(candidate.value);
    return committed.ok
      ? {
          ok: true,
          value: {
            revision: candidate.value.revision,
            beforeBytes: bytes.value,
            afterBytes: commitBytes,
          },
        }
      : committed;
  }

  async #cleanupPendingRecoveryLocked(
    assessmentTicketId: string,
  ): Promise<Result<RecoveryCleanupResume, FoundationError>> {
    const stored = await this.#deps.storage.readRecoveryControl();
    if (!stored.ok) return stored;
    const control = validateRecoveryControl(stored.value);
    if (!control.ok) return { ok: false, error: { code: "corrupt-data" } };
    if (
      !control.value.active ||
      control.value.assessmentTicketId !== assessmentTicketId ||
      control.value.assessmentIdentity === undefined ||
      control.value.commitMode === undefined
    )
      return { ok: false, error: { code: "stale-assessment" } };

    if (
      control.value.candidateDigest !== undefined &&
      control.value.expectedCommitRevision !== undefined
    ) {
      const current = await this.#readCurrentRoot();
      if (
        current.ok &&
        current.value.revision === control.value.expectedCommitRevision &&
        (await digestRoot(current.value)) === control.value.candidateDigest
      )
        return { ok: false, error: { code: "stale-assessment" } };
    }

    const released = recoveryControlPolicy.release(control.value, {
      generation: control.value.generation,
      ownerId: control.value.ownerId as string,
      leaseExpiresAt: control.value.leaseExpiresAt as string,
    });
    if (!released.ok)
      return { ok: false, error: recoveryControlFailure(released.error) };
    const committed = await this.#deps.storage.writeRecoveryControl(
      released.value,
    );
    return committed.ok
      ? {
          ok: true,
          value: {
            assessmentIdentity: control.value.assessmentIdentity,
            mode: control.value.commitMode,
          },
        }
      : { ok: false, error: { code: "precommit-cleanup-pending" } };
  }

  async #readCurrentRoot(): Promise<Result<LocalDataRoot, FoundationError>> {
    const stored = await this.#deps.storage.readRoot();
    if (!stored.ok) return stored;
    const migrated = this.#deps.migrations.toCurrent(
      stored.value ?? this.#deps.initialRoot(),
    );
    return migrated.ok
      ? migrated
      : { ok: false, error: migrationFailure(migrated.error) };
  }

  /** Every normal root writer rechecks durable recovery fencing while locked. */
  async #authorizeNormalWrite(): Promise<Result<void, FoundationError>> {
    const stored = await this.#deps.storage.readRecoveryControl();
    if (!stored.ok) return stored;
    const control = validateRecoveryControl(stored.value);
    if (!control.ok) return { ok: false, error: { code: "corrupt-data" } };
    const authorized = recoveryControlPolicy.authorizeNormalWrite(
      control.value,
    );
    return authorized.ok
      ? authorized
      : { ok: false, error: { code: "maintenance-active" } };
  }

  async #runMaintenanceLocked(
    command: MaintenanceCommand,
  ): Promise<Result<MaintenanceReceipt, FoundationError>> {
    const current = await this.#readCurrentRoot();
    if (!current.ok) return current;
    const recoveryAuthorized = await this.#authorizeNormalWrite();
    if (!recoveryAuthorized.ok) return recoveryAuthorized;
    const now = this.#deps.now();
    let transition: Result<MaintenanceTransition, FoundationError>;
    switch (command.type) {
      case "acquire":
        transition = this.#deps.maintenance.acquire(
          current.value,
          command.ownerId,
          command.leaseMs,
          now,
        );
        break;
      case "renew":
        transition = this.#deps.maintenance.renew(
          current.value,
          command.fence,
          command.leaseMs,
          now,
        );
        break;
      case "release":
        transition = this.#deps.maintenance.release(
          current.value,
          command.fence,
        );
        break;
      case "abort":
        transition = this.#deps.maintenance.abort(current.value, command.fence);
        break;
    }
    if (!transition.ok) return transition;
    if (transition.value.root.revision !== current.value.revision) {
      return { ok: false, error: { code: "revision-conflict" } };
    }
    const revision = nextRevision(current.value.revision);
    if (revision === undefined)
      return { ok: false, error: { code: "corrupt-data" } };
    const candidate = { ...transition.value.root, revision };
    const validated = this.#deps.validator.validateRoot(candidate);
    if (!validated.ok) return { ok: false, error: { code: "validation" } };
    const committed = await this.#deps.storage.writeRoot(validated.value);
    if (!committed.ok) return committed;
    return {
      ok: true,
      value:
        transition.value.fence === undefined
          ? {}
          : { fence: transition.value.fence },
    };
  }

  async #runRecoveryMaintenanceLocked(
    command: RecoveryMaintenanceCommand,
  ): Promise<Result<RecoveryMaintenanceReceipt, FoundationError>> {
    const stored = await this.#deps.storage.readRecoveryControl();
    if (!stored.ok) return stored;
    const control = validateRecoveryControl(stored.value);
    if (!control.ok) return { ok: false, error: { code: "corrupt-data" } };

    switch (command.type) {
      case "acquire": {
        const expiresAt = leaseExpiresAt(this.#deps.now(), command.leaseMs);
        if (!expiresAt.ok) return expiresAt;
        const acquired = recoveryControlPolicy.acquire(
          control.value,
          command.ownerId,
          expiresAt.value,
          command.assessmentTicketId,
          command.assessmentIdentity,
          command.commitMode,
        );
        if (!acquired.ok)
          return { ok: false, error: recoveryControlFailure(acquired.error) };
        const committed = await this.#deps.storage.writeRecoveryControl(
          acquired.value.control,
        );
        return committed.ok
          ? { ok: true, value: { fence: acquired.value.fence } }
          : committed;
      }
      case "renew": {
        const expiresAt = leaseExpiresAt(this.#deps.now(), command.leaseMs);
        if (!expiresAt.ok) return expiresAt;
        const renewed = recoveryControlPolicy.renew(
          control.value,
          command.fence,
          expiresAt.value,
          this.#deps.now(),
        );
        if (!renewed.ok)
          return { ok: false, error: recoveryControlFailure(renewed.error) };
        const committed = await this.#deps.storage.writeRecoveryControl(
          renewed.value,
        );
        return committed.ok
          ? {
              ok: true,
              value: {
                fence: { ...command.fence, leaseExpiresAt: expiresAt.value },
              },
            }
          : committed;
      }
      case "release":
      case "abort": {
        const transition = recoveryControlPolicy[command.type](
          control.value,
          command.fence,
          this.#deps.now(),
        );
        if (!transition.ok)
          return { ok: false, error: recoveryControlFailure(transition.error) };
        const committed = await this.#deps.storage.writeRecoveryControl(
          transition.value,
        );
        return committed.ok ? { ok: true, value: {} } : committed;
      }
    }
  }

  async #runLocked<T>(
    operation: RootTransactionOperation<T>,
  ): Promise<Result<T, FoundationError>> {
    const current = await this.#readCurrentRoot();
    if (!current.ok) return current;
    const recoveryAuthorized = await this.#authorizeNormalWrite();
    if (!recoveryAuthorized.ok) return recoveryAuthorized;
    const snapshot = current.value;

    const bytes = await this.#deps.storage.bytesInUse();
    if (!bytes.ok) return bytes;
    let quotaBytes: number;
    try {
      quotaBytes = this.#deps.storage.quotaBytes();
    } catch {
      return { ok: false, error: { code: "storage-unavailable" } };
    }
    if (
      !Number.isSafeInteger(bytes.value) ||
      bytes.value < 0 ||
      !Number.isSafeInteger(quotaBytes) ||
      quotaBytes < 0
    ) {
      return { ok: false, error: { code: "storage-unavailable" } };
    }

    if (operation.expectedRevision !== snapshot.revision)
      return { ok: false, error: { code: "revision-conflict" } };
    const authorized = this.#deps.maintenance.authorizeWrite(
      snapshot,
      operation.maintenance,
      this.#deps.now(),
    );
    if (!authorized.ok) return authorized;

    let proposed: Result<RootTransactionCandidate<T>, FoundationError>;
    try {
      proposed = await operation.execute({
        snapshot,
        currentBytes: bytes.value,
        currentRootBytes: currentRootStorageBytes(bytes.value, snapshot),
        quotaBytes,
      });
    } catch {
      return { ok: false, error: { code: "validation" } };
    }
    if (!proposed.ok) return proposed;
    if (proposed.value.root.revision !== snapshot.revision)
      return { ok: false, error: { code: "revision-conflict" } };

    const revision = nextRevision(snapshot.revision);
    if (revision === undefined)
      return { ok: false, error: { code: "corrupt-data" } };
    const candidate = { ...proposed.value.root, revision };
    const validated = this.#deps.validator.validateRoot(candidate);
    if (!validated.ok) return { ok: false, error: { code: "validation" } };

    const committed = await this.#deps.storage.writeRoot(validated.value);
    return committed.ok ? { ok: true, value: proposed.value.value } : committed;
  }

  async #runRequestLocked<T>(
    operation: RequestRootTransactionOperation<T>,
  ): Promise<Result<RequestCommitReceipt<T>, FoundationError>> {
    const current = await this.#readCurrentRoot();
    if (!current.ok) return current;
    const recoveryAuthorized = await this.#authorizeNormalWrite();
    if (!recoveryAuthorized.ok) return recoveryAuthorized;
    const snapshot = current.value;
    let payloadDigest: string;
    try {
      payloadDigest = await requestPayloadDigest(operation.payload);
    } catch {
      return { ok: false, error: { code: "validation" } };
    }
    const previous = snapshot.requestDedupe.find(
      (record) => record.requestId === operation.requestId,
    );
    if (previous !== undefined) {
      return previous.payloadDigest === payloadDigest
        ? {
            ok: true,
            value: {
              committedRevision: previous.committedRevision,
              replayed: true,
            },
          }
        : { ok: false, error: { code: "request-conflict" } };
    }

    const bytes = await this.#deps.storage.bytesInUse();
    if (!bytes.ok) return bytes;
    let quotaBytes: number;
    try {
      quotaBytes = this.#deps.storage.quotaBytes();
    } catch {
      return { ok: false, error: { code: "storage-unavailable" } };
    }
    if (
      !Number.isSafeInteger(bytes.value) ||
      bytes.value < 0 ||
      !Number.isSafeInteger(quotaBytes) ||
      quotaBytes < 0
    )
      return { ok: false, error: { code: "storage-unavailable" } };
    if (operation.expectedRevision !== snapshot.revision)
      return { ok: false, error: { code: "revision-conflict" } };
    const authorized = this.#deps.maintenance.authorizeWrite(
      snapshot,
      operation.maintenance,
      this.#deps.now(),
    );
    if (!authorized.ok) return authorized;

    let proposed: Result<RootTransactionCandidate<T>, FoundationError>;
    try {
      proposed = await operation.execute({
        snapshot,
        currentBytes: bytes.value,
        currentRootBytes: currentRootStorageBytes(bytes.value, snapshot),
        quotaBytes,
      });
    } catch {
      return { ok: false, error: { code: "validation" } };
    }
    if (!proposed.ok) return proposed;
    if (proposed.value.root.revision !== snapshot.revision)
      return { ok: false, error: { code: "revision-conflict" } };
    const revision = nextRevision(snapshot.revision);
    if (revision === undefined)
      return { ok: false, error: { code: "corrupt-data" } };
    const requestDedupe = [
      ...snapshot.requestDedupe,
      {
        requestId: operation.requestId,
        payloadDigest,
        committedRevision: revision,
      },
    ].slice(-REQUEST_DEDUPE_LIMIT);
    const candidate = { ...proposed.value.root, revision, requestDedupe };
    const validated = this.#deps.validator.validateRoot(candidate);
    if (!validated.ok) return { ok: false, error: { code: "validation" } };
    const committed = await this.#deps.storage.writeRoot(validated.value);
    return committed.ok
      ? {
          ok: true,
          value: {
            committedRevision: revision,
            replayed: false,
            value: proposed.value.value,
          },
        }
      : committed;
  }
}

export const createRootTransactionRunner = (
  deps: RootTransactionRunnerDependencies,
): RootTransactionRunner => new DefaultRootTransactionRunner(deps);
