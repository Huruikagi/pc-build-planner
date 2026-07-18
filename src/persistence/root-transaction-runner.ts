import type {
  RequestId,
  Revision,
  UtcTimestamp,
} from "../domain/identifiers.js";
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
import { REQUEST_DEDUPE_LIMIT } from "./schema.js";

type RequestPayload =
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

  async #runRequestLocked<T>(
    operation: RequestRootTransactionOperation<T>,
  ): Promise<Result<RequestCommitReceipt<T>, FoundationError>> {
    const current = await this.#readCurrentRoot();
    if (!current.ok) return current;
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
