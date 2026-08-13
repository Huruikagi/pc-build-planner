import type {
  CoreResult,
  StorageError,
  StoragePort,
} from "../contracts.js";

export interface ChromeStorageKeyScope {
  readonly root: string;
  readonly control: string;
}

export interface ChromeStorageChange {
  readonly oldValue?: unknown;
  readonly newValue?: unknown;
}

export interface ChromeStorageChangeEvent {
  addListener(
    listener: (
      changes: Readonly<Record<string, ChromeStorageChange>>,
      areaName: string,
    ) => void,
  ): void;
  removeListener(
    listener: (
      changes: Readonly<Record<string, ChromeStorageChange>>,
      areaName: string,
    ) => void,
  ): void;
}

export interface ChromeStorageLocalApi {
  readonly QUOTA_BYTES: number;
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  getBytesInUse(keys: readonly string[]): Promise<number>;
  setAccessLevel(options: {
    readonly accessLevel: "TRUSTED_CONTEXTS";
  }): Promise<void>;
}

export interface ChromeStorageApi {
  readonly local: ChromeStorageLocalApi;
  readonly onChanged: ChromeStorageChangeEvent;
}

export interface ScopedStorageChange {
  readonly key: "root" | "control";
  readonly oldValue?: unknown;
  readonly newValue?: unknown;
}

export interface ChromeStoragePort<Root, Control>
  extends StoragePort<Root, Control> {
  subscribe(listener: (change: ScopedStorageChange) => void): () => void;
}

const ok = <T>(value: T): CoreResult<T, never> => ({ ok: true, value });
const error = (code: StorageError["code"]): CoreResult<never, StorageError> => ({
  ok: false,
  error: { code },
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isQuotaRejection = (cause: unknown): boolean => {
  if (!isRecord(cause)) return false;
  const name = typeof cause.name === "string" ? cause.name : "";
  const message = typeof cause.message === "string" ? cause.message : "";
  return /quota/i.test(name) || /quota/i.test(message);
};

class DefaultChromeStoragePort<Root, Control>
  implements ChromeStoragePort<Root, Control>
{
  readonly #api: ChromeStorageApi;
  readonly #keys: ChromeStorageKeyScope;

  constructor(api: ChromeStorageApi, keys: ChromeStorageKeyScope) {
    this.#api = api;
    this.#keys = keys;
  }

  readRoot() {
    return this.#read(this.#keys.root);
  }

  writeRoot(root: Root) {
    return this.#write(this.#keys.root, root);
  }

  readControl() {
    return this.#read(this.#keys.control);
  }

  writeControl(control: Control) {
    return this.#write(this.#keys.control, control);
  }

  async bytesInUse(): Promise<CoreResult<number, StorageError>> {
    try {
      const bytes = await this.#api.local.getBytesInUse([
        this.#keys.root,
        this.#keys.control,
      ]);
      return Number.isSafeInteger(bytes) && bytes >= 0
        ? ok(bytes)
        : error("storage-unavailable");
    } catch {
      return error("storage-unavailable");
    }
  }

  quotaBytes(): number {
    return this.#api.local.QUOTA_BYTES;
  }

  async restrictToTrustedContexts(): Promise<CoreResult<void, StorageError>> {
    return ok(undefined);
  }

  subscribe(listener: (change: ScopedStorageChange) => void): () => void {
    let active = true;
    const onChanged = (
      changes: Readonly<Record<string, ChromeStorageChange>>,
      areaName: string,
    ): void => {
      if (!active || areaName !== "local" || !isRecord(changes)) return;
      this.#notifyChange(changes, this.#keys.root, "root", listener);
      this.#notifyChange(changes, this.#keys.control, "control", listener);
    };
    this.#api.onChanged.addListener(onChanged);
    return () => {
      if (!active) return;
      active = false;
      this.#api.onChanged.removeListener(onChanged);
    };
  }

  async #read(key: string): Promise<CoreResult<unknown | undefined, StorageError>> {
    try {
      const response: unknown = await this.#api.local.get(key);
      return isRecord(response)
        ? ok(response[key])
        : error("storage-unavailable");
    } catch {
      return error("storage-unavailable");
    }
  }

  async #write(
    key: string,
    value: Root | Control,
  ): Promise<CoreResult<void, StorageError>> {
    try {
      await this.#api.local.set({ [key]: value });
      return ok(undefined);
    } catch (cause) {
      return error(
        isQuotaRejection(cause) ? "quota-exceeded" : "storage-unavailable",
      );
    }
  }

  #notifyChange(
    changes: Readonly<Record<string, ChromeStorageChange>>,
    platformKey: string,
    key: ScopedStorageChange["key"],
    listener: (change: ScopedStorageChange) => void,
  ): void {
    if (!(platformKey in changes)) return;
    const change = changes[platformKey];
    if (!isRecord(change)) return;
    const scoped: {
      key: ScopedStorageChange["key"];
      oldValue?: unknown;
      newValue?: unknown;
    } = { key };
    if ("oldValue" in change) scoped.oldValue = change.oldValue;
    if ("newValue" in change) scoped.newValue = change.newValue;
    listener(scoped);
  }
}

export const createChromeStorageAdapter = async <Root, Control>(
  api: ChromeStorageApi,
  keyScope: ChromeStorageKeyScope,
): Promise<CoreResult<ChromeStoragePort<Root, Control>, StorageError>> => {
  if (
    keyScope.root.length === 0 ||
    keyScope.control.length === 0 ||
    keyScope.root === keyScope.control ||
    !Number.isSafeInteger(api.local.QUOTA_BYTES) ||
    api.local.QUOTA_BYTES < 0
  ) {
    return error("storage-unavailable");
  }
  try {
    await api.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  } catch {
    return error("access-denied");
  }
  return ok(new DefaultChromeStoragePort<Root, Control>(api, keyScope));
};
