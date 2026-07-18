import type { LocalDataRoot } from "../domain/model.js";
import type { Result } from "../domain/result.js";
import type { StorageError, StoragePort } from "./repository.js";

const DEFAULT_QUOTA_BYTES = 10 * 1024 * 1024;
// schema.tsの公開契約と同じ物理key。adapterはこの一件以外を操作しない。
const STORAGE_KEY = "localDataRoot";

export type InMemoryStorageOperation = "read" | "write" | "bytes" | "access";

export interface InMemoryStorageState {
  readonly entries: Map<string, unknown>;
  readonly quota: number;
  trustedContextsOnly: boolean;
  failNext(operation: InMemoryStorageOperation): void;
  consumeFailure(operation: InMemoryStorageOperation): boolean;
}

export interface InMemoryStorageStateOptions {
  readonly quotaBytes?: number;
}

const storageUnavailable = (): StorageError => ({
  code: "storage-unavailable",
});
const accessDenied = (): StorageError => ({ code: "access-denied" });
const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

const cloneJson = <T>(value: T): T => structuredClone(value);

export const createInMemoryStorageState = (
  options: InMemoryStorageStateOptions = {},
): InMemoryStorageState => {
  const failures = new Set<InMemoryStorageOperation>();
  return {
    entries: new Map<string, unknown>(),
    quota: options.quotaBytes ?? DEFAULT_QUOTA_BYTES,
    trustedContextsOnly: false,
    failNext(operation) {
      failures.add(operation);
    },
    consumeFailure(operation) {
      if (!failures.has(operation)) return false;
      failures.delete(operation);
      return true;
    },
  };
};

class InMemoryStorageAdapter implements StoragePort {
  readonly #state: InMemoryStorageState;

  constructor(state: InMemoryStorageState) {
    this.#state = state;
  }

  async readRoot() {
    if (this.#state.consumeFailure("read")) return err(storageUnavailable());
    const stored = this.#state.entries.get(STORAGE_KEY);
    return ok(stored === undefined ? undefined : cloneJson(stored));
  }

  async writeRoot(root: LocalDataRoot) {
    if (this.#state.consumeFailure("write")) return err(storageUnavailable());
    this.#state.entries.set(STORAGE_KEY, cloneJson(root));
    return ok(undefined);
  }

  async bytesInUse() {
    if (this.#state.consumeFailure("bytes")) return err(storageUnavailable());
    const root = this.#state.entries.get(STORAGE_KEY);
    if (root === undefined) return ok(0);
    const serialized = JSON.stringify({ [STORAGE_KEY]: root });
    return ok(new TextEncoder().encode(serialized).byteLength);
  }

  quotaBytes() {
    return this.#state.quota;
  }

  async restrictToTrustedContexts() {
    if (this.#state.consumeFailure("access")) return err(accessDenied());
    this.#state.trustedContextsOnly = true;
    return ok(undefined);
  }
}

export const createInMemoryStorageAdapter = (
  state: InMemoryStorageState = createInMemoryStorageState(),
): StoragePort => new InMemoryStorageAdapter(state);
