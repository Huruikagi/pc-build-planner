import type { UtcTimestamp } from "../domain/identifiers.js";
import type { FoundationError, Result } from "../domain/result.js";
import { schemaValidator } from "../domain/validation.js";
import {
  type ChromeStorageLocalApi,
  createChromeStorageAdapter,
} from "./chrome-storage-adapter.js";
import { maintenancePolicy } from "./maintenance.js";
import type {
  MaintenanceSnapshotSource,
  StorageChangeEvent,
} from "./maintenance-snapshot-source.js";
import { createMaintenanceSnapshotSource } from "./maintenance-snapshot-source.js";
import { createMigrationRegistry } from "./migration-registry.js";
import { createMutationPipeline } from "./mutation-pipeline.js";
import { createRecoveryCoordinator } from "./recovery.js";
import { referenceRepairPolicy } from "./reference-repair-policy.js";
import { createReplacementCoordinator } from "./replacement.js";
import { createLocalDataRepository } from "./repository.js";
import { createRootTransactionRunner } from "./root-transaction-runner.js";
import { CURRENT_SCHEMA_VERSION, createInitialRoot } from "./schema.js";
import {
  createWebLocksAdapter,
  type WebLocksApi,
} from "./web-locks-adapter.js";
import {
  type CallerClassification,
  createDataWorkerRegistration,
  type DataWorkerRegistration,
  type FoundationCommand,
} from "./worker-registration.js";
import {
  type BackupRestoreDataPort,
  createBackupRestoreDataPort,
  createScopedDataPort,
  createWriteAuthority,
  type FoundationScopedDataPort,
} from "./write-authority.js";

export interface FoundationRuntimePlatform {
  readonly storageLocal: ChromeStorageLocalApi;
  readonly storageChanges: StorageChangeEvent;
  readonly locks: WebLocksApi;
  readonly authorize: (
    caller: CallerClassification,
    command: FoundationCommand,
  ) => boolean | Promise<boolean>;
  readonly now: () => UtcTimestamp;
  readonly reportError: (error: FoundationError) => void;
}

export interface FoundationRuntimeContribution {
  readonly maintenanceSource: MaintenanceSnapshotSource;
  readonly workerRegistration: DataWorkerRegistration;
  /** 参照と原子的root mutationだけへ絞ったUI context向けport。 */
  readonly dataPort: FoundationScopedDataPort;
  /** backup/restore compositionだけへ渡す用途限定port。 */
  readonly backupRestoreDataPort: BackupRestoreDataPort;
  dispose(): void | Promise<void>;
}

export type FoundationRuntimeInitializationError =
  | { readonly code: "invalid-platform" }
  | Extract<
      FoundationError,
      {
        readonly code:
          | "access-denied"
          | "quota-exceeded"
          | "storage-unavailable";
      }
    >;

const isFunction = (value: unknown): value is (...args: never[]) => unknown =>
  typeof value === "function";

const validPlatform = (value: unknown): value is FoundationRuntimePlatform => {
  if (typeof value !== "object" || value === null) return false;
  const platform = value as Partial<FoundationRuntimePlatform>;
  const storage = platform.storageLocal as
    | Partial<ChromeStorageLocalApi>
    | undefined;
  const changes = platform.storageChanges as
    | Partial<StorageChangeEvent>
    | undefined;
  const locks = platform.locks as Partial<WebLocksApi> | undefined;
  return (
    typeof storage === "object" &&
    storage !== null &&
    isFunction(storage.get) &&
    isFunction(storage.set) &&
    isFunction(storage.getBytesInUse) &&
    isFunction(storage.setAccessLevel) &&
    typeof storage.QUOTA_BYTES === "number" &&
    Number.isSafeInteger(storage.QUOTA_BYTES) &&
    storage.QUOTA_BYTES >= 0 &&
    typeof changes === "object" &&
    changes !== null &&
    isFunction(changes.addListener) &&
    isFunction(changes.removeListener) &&
    typeof locks === "object" &&
    locks !== null &&
    isFunction(locks.request) &&
    isFunction(platform.authorize) &&
    isFunction(platform.now) &&
    isFunction(platform.reportError)
  );
};

export const initializeFoundationRuntimeContributionFromPlatform = async (
  platform: FoundationRuntimePlatform,
): Promise<
  Result<FoundationRuntimeContribution, FoundationRuntimeInitializationError>
> => {
  if (!validPlatform(platform))
    return { ok: false, error: { code: "invalid-platform" } };

  const storage = createChromeStorageAdapter(platform.storageLocal);
  const restricted = await storage.restrictToTrustedContexts();
  if (!restricted.ok) return restricted;

  const migrations = createMigrationRegistry(
    CURRENT_SCHEMA_VERSION,
    [],
    schemaValidator,
  );
  const repository = createLocalDataRepository(storage, migrations);
  const lock = createWebLocksAdapter(platform.locks);
  const replacement = createReplacementCoordinator(migrations, schemaValidator);
  const recovery = createRecoveryCoordinator(storage, migrations, replacement);
  const runner = createRootTransactionRunner({
    storage,
    lock,
    migrations,
    validator: schemaValidator,
    maintenance: maintenancePolicy,
    replacement,
    recovery,
    now: platform.now,
    initialRoot: createInitialRoot,
  });
  const pipeline = createMutationPipeline(
    schemaValidator,
    referenceRepairPolicy,
  );
  const authority = createWriteAuthority({ repository, runner, pipeline });
  const maintenanceSource = createMaintenanceSnapshotSource({
    repository,
    changes: platform.storageChanges,
    reportError: platform.reportError,
  });
  const workerRegistration = createDataWorkerRegistration({
    restrictAccess: async () => restricted,
    authorize: platform.authorize,
    data: authority,
  });

  let disposed = false;
  return {
    ok: true,
    value: {
      maintenanceSource,
      workerRegistration,
      dataPort: createScopedDataPort(authority),
      backupRestoreDataPort: createBackupRestoreDataPort(runner),
      dispose() {
        if (disposed) return;
        disposed = true;
      },
    },
  };
};
