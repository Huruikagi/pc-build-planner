import type { LocalDataRoot } from "../domain/model.js";
import type { FoundationError, Result } from "../domain/result.js";
import type {
  MigrationError,
  MigrationRegistry,
} from "./migration-registry.js";
import { createInitialRoot } from "./schema.js";

export type StorageError = Extract<
  FoundationError,
  { readonly code: "access-denied" | "quota-exceeded" | "storage-unavailable" }
>;

/** Platform APIをdomain persistenceから隔離する単一root保存port。 */
export interface StoragePort {
  readRoot(): Promise<Result<unknown | undefined, StorageError>>;
  writeRoot(root: LocalDataRoot): Promise<Result<void, StorageError>>;
  bytesInUse(): Promise<Result<number, StorageError>>;
  quotaBytes(): number;
  restrictToTrustedContexts(): Promise<Result<void, StorageError>>;
}

export type ReadSnapshot = LocalDataRoot;
export type RootQuery<T> = (snapshot: ReadSnapshot) => T;

export type RepositoryError = Extract<
  FoundationError,
  | { readonly code: "access-denied" }
  | { readonly code: "corrupt-data" }
  | { readonly code: "migration-failed" }
  | { readonly code: "quota-exceeded" }
  | { readonly code: "storage-unavailable" }
  | { readonly code: "unsupported-version" }
>;

/** 検証済みsnapshotだけを公開するread-only persistence境界。 */
export interface LocalDataRepository {
  readRoot(): Promise<Result<ReadSnapshot, RepositoryError>>;
  query<T>(query: RootQuery<T>): Promise<Result<T, RepositoryError>>;
}

const migrationErrorToRepositoryError = (
  error: MigrationError,
): RepositoryError => {
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

class DefaultLocalDataRepository implements LocalDataRepository {
  readonly #storage: StoragePort;
  readonly #migrations: MigrationRegistry;

  constructor(storage: StoragePort, migrations: MigrationRegistry) {
    this.#storage = storage;
    this.#migrations = migrations;
  }

  async readRoot(): Promise<Result<ReadSnapshot, RepositoryError>> {
    const stored = await this.#storage.readRoot();
    if (!stored.ok) return stored;
    if (stored.value === undefined)
      return { ok: true, value: createInitialRoot() };
    const migrated = this.#migrations.toCurrent(stored.value);
    return migrated.ok
      ? migrated
      : { ok: false, error: migrationErrorToRepositoryError(migrated.error) };
  }

  async query<T>(query: RootQuery<T>): Promise<Result<T, RepositoryError>> {
    const snapshot = await this.readRoot();
    return snapshot.ok ? { ok: true, value: query(snapshot.value) } : snapshot;
  }
}

export const createLocalDataRepository = (
  storage: StoragePort,
  migrations: MigrationRegistry,
): LocalDataRepository => new DefaultLocalDataRepository(storage, migrations);
