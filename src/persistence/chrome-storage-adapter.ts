import type { LocalDataRoot } from "../domain/model.js";
import type { Result } from "../domain/result.js";
import type { StorageError, StoragePort } from "./repository.js";

const STORAGE_KEY = "localDataRoot";

export interface ChromeStorageLocalApi {
  readonly QUOTA_BYTES: number;
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  getBytesInUse(key: string): Promise<number>;
  setAccessLevel(options: {
    readonly accessLevel: "TRUSTED_CONTEXTS";
  }): Promise<void>;
}

const unavailable = (): StorageError => ({ code: "storage-unavailable" });
const quotaExceeded = (): StorageError => ({ code: "quota-exceeded" });
const accessDenied = (): StorageError => ({ code: "access-denied" });
const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

const isQuotaError = (cause: unknown): boolean =>
  cause instanceof Error && /quota/i.test(cause.message);

class ChromeStorageAdapter implements StoragePort {
  readonly #storage: ChromeStorageLocalApi;

  constructor(storage: ChromeStorageLocalApi) {
    this.#storage = storage;
  }

  async readRoot() {
    try {
      const stored = await this.#storage.get(STORAGE_KEY);
      return ok(stored[STORAGE_KEY]);
    } catch {
      return err(unavailable());
    }
  }

  async writeRoot(root: LocalDataRoot) {
    try {
      await this.#storage.set({ [STORAGE_KEY]: root });
      return ok(undefined);
    } catch (cause) {
      return err(isQuotaError(cause) ? quotaExceeded() : unavailable());
    }
  }

  async bytesInUse() {
    try {
      return ok(await this.#storage.getBytesInUse(STORAGE_KEY));
    } catch {
      return err(unavailable());
    }
  }

  quotaBytes() {
    return this.#storage.QUOTA_BYTES;
  }

  async restrictToTrustedContexts() {
    try {
      await this.#storage.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
      return ok(undefined);
    } catch {
      return err(accessDenied());
    }
  }
}

export const createChromeStorageAdapter = (
  storage: ChromeStorageLocalApi,
): StoragePort => new ChromeStorageAdapter(storage);
