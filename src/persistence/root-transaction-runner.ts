import type { Revision, UtcTimestamp } from "../domain/identifiers.js";
import type { LocalDataRoot } from "../domain/model.js";
import type { FoundationError, Result } from "../domain/result.js";
import type { SchemaValidator } from "../domain/validation.js";
import type { MaintenanceFence, MaintenancePolicy } from "./maintenance.js";
import type {
  MigrationError,
  MigrationRegistry,
} from "./migration-registry.js";
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
}

export interface RootTransactionRunnerDependencies {
  readonly storage: StoragePort;
  readonly lock: RootWriteLock;
  readonly migrations: MigrationRegistry;
  readonly validator: SchemaValidator;
  readonly maintenance: MaintenancePolicy;
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

  async #runLocked<T>(
    operation: RootTransactionOperation<T>,
  ): Promise<Result<T, FoundationError>> {
    const stored = await this.#deps.storage.readRoot();
    if (!stored.ok) return stored;
    const migrated = this.#deps.migrations.toCurrent(
      stored.value ?? this.#deps.initialRoot(),
    );
    if (!migrated.ok)
      return { ok: false, error: migrationFailure(migrated.error) };
    const snapshot = migrated.value;

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
