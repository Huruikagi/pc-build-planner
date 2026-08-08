import type { LocalDataRoot } from "../domain/model.js";
import type { Result } from "../domain/result.js";
import type { StorageError, StoragePort } from "./repository.js";
import {
  LOCAL_DATA_STORAGE_KEY,
  RECOVERY_CONTROL_STORAGE_KEY,
} from "./schema.js";

export interface ChromeStorageLocalApi {
  readonly QUOTA_BYTES: number;
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  getBytesInUse(key: string | readonly string[]): Promise<number>;
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
      const stored = await this.#storage.get(LOCAL_DATA_STORAGE_KEY);
      return ok(stored[LOCAL_DATA_STORAGE_KEY]);
    } catch {
      return err(unavailable());
    }
  }

  async writeRoot(root: LocalDataRoot) {
    try {
      await this.#storage.set({ [LOCAL_DATA_STORAGE_KEY]: root });
      return ok(undefined);
    } catch (cause) {
      return err(isQuotaError(cause) ? quotaExceeded() : unavailable());
    }
  }

  async bytesInUse() {
    try {
      return ok(
        await this.#storage.getBytesInUse([
          LOCAL_DATA_STORAGE_KEY,
          RECOVERY_CONTROL_STORAGE_KEY,
        ]),
      );
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

  async readRecoveryControl() {
    try {
      const stored = await this.#storage.get(RECOVERY_CONTROL_STORAGE_KEY);
      return ok(stored[RECOVERY_CONTROL_STORAGE_KEY]);
    } catch {
      return err(unavailable());
    }
  }

  async writeRecoveryControl(control: unknown) {
    try {
      await this.#storage.set({ [RECOVERY_CONTROL_STORAGE_KEY]: control });
      return ok(undefined);
    } catch (cause) {
      return err(isQuotaError(cause) ? quotaExceeded() : unavailable());
    }
  }
}

export const createChromeStorageAdapter = (
  storage: ChromeStorageLocalApi,
): StoragePort => new ChromeStorageAdapter(storage);
