import type { Revision, UtcTimestamp } from "../domain/identifiers.js";
import type { LocalDataRoot, MaintenanceOwnerId } from "../domain/model.js";
import type { FoundationError, Result } from "../domain/result.js";
import type { SchemaValidator } from "../domain/validation.js";
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
  ReplacementAssessment,
  ReplacementError,
  ReplacementEvaluator,
} from "./replacement.js";
import type { StoragePort } from "./repository.js";
import type { RootWriteLock } from "./root-write-lock.js";

export interface RootTransactionContext {
  readonly snapshot: LocalDataRoot;
  readonly currentBytes: number;
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

export interface RootTransactionRunner {
  run<T>(
    operation: RootTransactionOperation<T>,
  ): Promise<Result<T, FoundationError>>;
  runMaintenance(
    command: MaintenanceCommand,
  ): Promise<Result<MaintenanceReceipt, FoundationError>>;
  replaceRoot(
    command: ReplacementCommand,
  ): Promise<Result<ReplacementReceipt, FoundationError>>;
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

export interface RootTransactionRunnerDependencies {
  readonly storage: StoragePort;
  readonly lock: RootWriteLock;
  readonly migrations: MigrationRegistry;
  readonly validator: SchemaValidator;
  readonly maintenance: MaintenancePolicy;
  readonly replacement?: ReplacementEvaluator;
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

  async #replaceRootLocked(
    command: ReplacementCommand,
  ): Promise<Result<ReplacementReceipt, FoundationError>> {
    const current = await this.#readCurrentRoot();
    if (!current.ok) return current;
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

  async #runMaintenanceLocked(
    command: MaintenanceCommand,
  ): Promise<Result<MaintenanceReceipt, FoundationError>> {
    const current = await this.#readCurrentRoot();
    if (!current.ok) return current;
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

  async #runLocked<T>(
    operation: RootTransactionOperation<T>,
  ): Promise<Result<T, FoundationError>> {
    const current = await this.#readCurrentRoot();
    if (!current.ok) return current;
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
}

export const createRootTransactionRunner = (
  deps: RootTransactionRunnerDependencies,
): RootTransactionRunner => new DefaultRootTransactionRunner(deps);
