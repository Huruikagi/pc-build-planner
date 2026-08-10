import type { OperationKind } from "../../src/application-shell/public.js";
import type {
  LocalDataRoot,
  ProjectId,
  RequestId,
  Result,
  UtcTimestamp,
} from "../../src/domain/public.js";
import { schemaValidator } from "../../src/domain/public.js";
import { createBackupRestoreSectionMount } from "../../src/features/backup-restore/public.js";
import {
  createInMemoryStorageAdapter,
  createInMemoryStorageState,
} from "../../src/persistence/in-memory-storage-adapter.js";
import { maintenancePolicy } from "../../src/persistence/maintenance.js";
import { createMigrationRegistry } from "../../src/persistence/migration-registry.js";
import { createMutationPipeline } from "../../src/persistence/mutation-pipeline.js";
import { createRecoveryCoordinator } from "../../src/persistence/recovery.js";
import { referenceRepairPolicy } from "../../src/persistence/reference-repair-policy.js";
import { createReplacementCoordinator } from "../../src/persistence/replacement.js";
import type {
  RootQuery,
  StoragePort,
} from "../../src/persistence/repository.js";
import { createLocalDataRepository } from "../../src/persistence/repository.js";
import { createRootTransactionRunner } from "../../src/persistence/root-transaction-runner.js";
import { createInMemoryRootWriteLock } from "../../src/persistence/root-write-lock.js";
import {
  createInitialRoot,
  LOCAL_DATA_STORAGE_KEY,
  RECOVERY_CONTROL_STORAGE_KEY,
} from "../../src/persistence/schema.js";
import {
  createBackupRestoreDataPort,
  createWriteAuthority,
} from "../../src/persistence/write-authority.js";
import type {
  ProjectContextCommandPort,
  ProjectContextReplacementGuardPort,
  ProjectContextSnapshot,
} from "../../src/project-context/public.js";

/**
 * Drives the production backup/restore section mount in a real browser against
 * a real Foundation, with faults injected only at the storage boundary. That
 * keeps the commit protocol, the persistent recovery control and the cleanup
 * resume genuine while letting a spec force the failure points that a healthy
 * Chrome profile never reaches.
 */

const EXISTING_PROJECT_ID = "50000000-0000-4000-8000-000000000001" as ProjectId;
const SEED_TIME = "2026-07-19T00:00:00.000Z" as UtcTimestamp;

const seededRoot = (): LocalDataRoot =>
  ({
    ...createInitialRoot(),
    projects: [
      {
        id: EXISTING_PROJECT_ID,
        name: "架空既存プロジェクト",
        createdAt: SEED_TIME,
        updatedAt: SEED_TIME,
      },
    ],
  }) as unknown as LocalDataRoot;

const storageState = createInMemoryStorageState({ quotaBytes: 10_000_000 });
storageState.entries.set(LOCAL_DATA_STORAGE_KEY, seededRoot());

/** Counters and injected faults survive a foundation rebuild on purpose. */
let rootWrites = 0;
let controlWrites = 0;
let failingControlWrites = new Set<number>();
let quotaOverride: number | undefined;
let commitCalls = 0;
let finalizeCalls = 0;
let refreshCalls = 0;
const guardCalls = { prepare: 0, confirm: 0, cancel: 0, begin: 0, complete: 0 };
const guardOutcomes: string[] = [];

const faultInjectingStorage = (inner: StoragePort): StoragePort => ({
  readRoot: () => inner.readRoot(),
  async writeRoot(root) {
    rootWrites += 1;
    return inner.writeRoot(root);
  },
  bytesInUse: () => inner.bytesInUse(),
  readRecoveryControl: () => inner.readRecoveryControl(),
  async writeRecoveryControl(control) {
    controlWrites += 1;
    if (failingControlWrites.has(controlWrites))
      return { ok: false, error: { code: "storage-unavailable" } };
    return inner.writeRecoveryControl(control);
  },
  quotaBytes: () => quotaOverride ?? inner.quotaBytes(),
  restrictToTrustedContexts: () => inner.restrictToTrustedContexts(),
});

/** Retained so a spec can land a competing ordinary mutation after preflight. */
let lastAuthority: ReturnType<typeof createWriteAuthority> | undefined;

const createFoundation = () => {
  const storage = faultInjectingStorage(
    createInMemoryStorageAdapter(storageState),
  );
  const migrations = createMigrationRegistry(1, [], schemaValidator);
  const replacement = createReplacementCoordinator(migrations, schemaValidator);
  const runner = createRootTransactionRunner({
    storage,
    lock: createInMemoryRootWriteLock(),
    migrations,
    validator: schemaValidator,
    maintenance: maintenancePolicy,
    replacement,
    recovery: createRecoveryCoordinator(storage, migrations, replacement),
    now: () => new Date().toISOString() as UtcTimestamp,
    initialRoot: createInitialRoot,
  });
  const authority = createWriteAuthority({
    repository: createLocalDataRepository(storage, migrations),
    runner,
    pipeline: createMutationPipeline(schemaValidator, referenceRepairPolicy),
  });
  const port = createBackupRestoreDataPort(runner);
  lastAuthority = authority;
  return {
    read: {
      query<T>(query: RootQuery<T>) {
        return authority.query(query);
      },
    },
    restore: {
      assessReplacement: (input: unknown) => port.assessReplacement(input),
      assessRecovery: (candidate: unknown) => port.assessRecovery(candidate),
      commit: (command: Parameters<typeof port.commit>[0]) => {
        commitCalls += 1;
        return port.commit(command);
      },
      findPendingFinalization: () => port.findPendingFinalization(),
      finalize: (ticket: Parameters<typeof port.finalize>[0]) => {
        finalizeCalls += 1;
        return port.finalize(ticket);
      },
    },
  };
};

type GuardMode = "permit" | "confirmation" | "reject";
let guardMode: GuardMode = "permit";
let permitSerial = 0;

/**
 * Stands in for project-context. Only the permit lifecycle the backup feature
 * is allowed to see is exposed, and every call is recorded so a spec can pin
 * the order the feature must follow.
 */
const replacementGuard: ProjectContextReplacementGuardPort = {
  async prepare() {
    guardCalls.prepare += 1;
    if (guardMode === "reject")
      return { ok: false, error: { kind: "guard-failed" } };
    permitSerial += 1;
    if (guardMode === "confirmation")
      return {
        ok: true,
        value: {
          kind: "confirmation-required",
          confirmation: {
            id: `harness-confirmation-${permitSerial}`,
            baseGeneration: 0,
            registryRevision: 0,
          },
        },
      };
    return {
      ok: true,
      value: {
        kind: "permitted",
        permit: {
          id: `harness-permit-${permitSerial}`,
          baseGeneration: 0,
          registryRevision: 0,
        },
      },
    };
  },
  async confirm(confirmationId: string) {
    guardCalls.confirm += 1;
    return {
      ok: true,
      value: {
        id: `harness-permit-from-${confirmationId}`,
        baseGeneration: 0,
        registryRevision: 0,
      },
    };
  },
  cancel() {
    guardCalls.cancel += 1;
    return { ok: true, value: undefined };
  },
  begin() {
    guardCalls.begin += 1;
    return { ok: true, value: undefined };
  },
  async complete(_permitId: string, outcome: string) {
    guardCalls.complete += 1;
    guardOutcomes.push(outcome);
    return { ok: true, value: undefined };
  },
};

type RefreshResult = "ready" | "empty" | "unavailable";
let refreshResult: RefreshResult = "empty";

const projectContext: Pick<ProjectContextCommandPort, "refresh"> = {
  async refresh(): Promise<
    Result<ProjectContextSnapshot, { readonly kind: "context-unavailable" }>
  > {
    refreshCalls += 1;
    if (refreshResult === "unavailable")
      return { ok: false, error: { kind: "context-unavailable" } };
    return {
      ok: true,
      value: {
        status: refreshResult,
        generation: refreshCalls,
        catalog: [],
        selectedProjectId: null,
      } as unknown as ProjectContextSnapshot,
    };
  },
};

/** Every operation is permitted; the shell gate has its own contract tests. */
const operationPolicy = {
  isAllowed: (_kind: OperationKind) => true,
  subscribe: () => () => undefined,
};

let handle: { unmount(): Promise<void> } | undefined;

const mountSection = async (): Promise<void> => {
  const container = document.querySelector<HTMLElement>("#root");
  if (container === null) throw new Error("Missing test harness root.");
  await handle?.unmount();
  container.replaceChildren();
  const foundation = createFoundation();
  handle = await createBackupRestoreSectionMount({
    read: foundation.read,
    restore: foundation.restore,
    replacementGuard,
    projectContext,
  }).mount({
    container,
    operationPolicy,
    reportError: () => undefined,
  });
};

const storedProjectNames = (): readonly string[] => {
  const root = storageState.entries.get(LOCAL_DATA_STORAGE_KEY) as
    | { readonly projects?: readonly { readonly name: string }[] }
    | undefined;
  return (root?.projects ?? []).map((project) => project.name);
};

void mountSection().then(() =>
  Object.assign(window, {
    backupRestoreHarness: {
      /** Re-mounts with a fresh state and a rebuilt foundation (worker restart). */
      remount: () => mountSection(),
      failControlWrites(indices: readonly number[]) {
        failingControlWrites = new Set(indices);
      },
      setQuota(bytes: number | null) {
        quotaOverride = bytes ?? undefined;
      },
      setGuardMode(mode: GuardMode) {
        guardMode = mode;
      },
      setRefreshResult(result: RefreshResult) {
        refreshResult = result;
      },
      counters() {
        return {
          rootWrites,
          controlWrites,
          commitCalls,
          finalizeCalls,
          refreshCalls,
          guard: { ...guardCalls },
          guardOutcomes: [...guardOutcomes],
        };
      },
      storedProjectNames,
      /** Replaces the stored root so a spec can start from an anomalous one. */
      seedStoredRoot(kind: "healthy" | "corrupt" | "unsupported") {
        storageState.entries.delete(RECOVERY_CONTROL_STORAGE_KEY);
        storageState.entries.set(
          LOCAL_DATA_STORAGE_KEY,
          kind === "healthy"
            ? seededRoot()
            : kind === "corrupt"
              ? { schemaVersion: 1, revision: "broken" }
              : { schemaVersion: 99, opaque: "synthetic" },
        );
      },
      /**
       * Lands an ordinary mutation through the same Foundation, so a spec can
       * confirm a preflight taken before it is rejected as stale rather than
       * overwriting the newer change.
       */
      async renameExistingProject(name: string) {
        const authority = lastAuthority;
        if (authority === undefined) throw new Error("foundation is not built");
        const revision = await authority.query((root) => root.revision);
        if (!revision.ok) return revision;
        return authority.mutate({
          requestId: globalThis.crypto.randomUUID() as RequestId,
          expectedRevision: revision.value,
          operation: {
            entity: "project",
            kind: "update",
            value: {
              id: EXISTING_PROJECT_ID,
              name,
              createdAt: SEED_TIME,
              updatedAt: new Date().toISOString() as UtcTimestamp,
            },
          },
        });
      },
    },
  }),
);
