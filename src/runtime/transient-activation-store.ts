import type { FeatureId } from "../application-shell/contracts.js";
import type {
  ActivationId,
  TargetTabId,
} from "../application-shell/transient-surface-ports.js";
import { err, ok, type Result } from "../domain/public.js";

export type ActivationStage =
  | "pending"
  | "received"
  | "activated"
  | "invalidated";
export type ActivationSequence = number & {
  readonly __brand: "ActivationSequence";
};

export interface TransientActivationRecord {
  readonly activationId: ActivationId;
  readonly surfaceId: FeatureId;
  readonly tabId: TargetTabId;
  readonly seq: ActivationSequence;
  readonly stage: ActivationStage;
}

export interface TransientInvalidationTombstone {
  readonly tabId: TargetTabId;
  readonly seq: ActivationSequence;
}

export interface TransientActivationEnvelope {
  readonly version: 1;
  readonly lastSequence: ActivationSequence;
  readonly record?: TransientActivationRecord;
  readonly tombstones: readonly TransientInvalidationTombstone[];
}

export const MAX_TRANSIENT_TOMBSTONES = 128;
export const TRANSIENT_ACTIVATION_STORAGE_KEY = "transientActivationEnvelope";

export type ActivationStoreError =
  | { readonly kind: "storage-unavailable" }
  | { readonly kind: "unsupported-version" }
  | { readonly kind: "corrupt-envelope" }
  | { readonly kind: "invalid-stage-transition" }
  | { readonly kind: "activation-not-found" }
  | { readonly kind: "capacity-exceeded" };

export type ActivationAuthorization =
  | { readonly kind: "authorized"; readonly record: TransientActivationRecord }
  | {
      readonly kind: "invalidated";
      readonly record: TransientActivationRecord;
    };

export interface TransientSessionStorage {
  get(): Promise<unknown>;
  set(value: TransientActivationEnvelope): Promise<void>;
}

export interface TransientActivationStore {
  put(
    record: TransientActivationRecord,
  ): Promise<Result<void, ActivationStoreError>>;
  read(): Promise<
    Result<TransientActivationRecord | undefined, ActivationStoreError>
  >;
  readEnvelope(): Promise<
    Result<TransientActivationEnvelope, ActivationStoreError>
  >;
  requestAdvance(
    activationId: ActivationId,
    stage: "received" | "activated",
  ): Promise<Result<void, ActivationStoreError>>;
  invalidate(
    tombstone: TransientInvalidationTombstone,
  ): Promise<Result<void, ActivationStoreError>>;
  authorizeAfterWatchReady(
    activationId: ActivationId,
  ): Promise<Result<ActivationAuthorization, ActivationStoreError>>;
  checkpoint(): Promise<Result<void, ActivationStoreError>>;
  subscribe(
    listener: (record: TransientActivationRecord | undefined) => void,
  ): () => void;
}

const emptyEnvelope = (): TransientActivationEnvelope => ({
  version: 1,
  lastSequence: 0 as ActivationSequence,
  tombstones: [],
});

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isSequence = (value: unknown): value is ActivationSequence =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isTabId = (value: unknown): value is TargetTabId =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const stages = new Set<ActivationStage>([
  "pending",
  "received",
  "activated",
  "invalidated",
]);

const parseRecord = (value: unknown): TransientActivationRecord | undefined => {
  if (
    !isObject(value) ||
    typeof value.activationId !== "string" ||
    typeof value.surfaceId !== "string" ||
    !isTabId(value.tabId) ||
    !isSequence(value.seq) ||
    !stages.has(value.stage as ActivationStage)
  )
    return undefined;
  return value as unknown as TransientActivationRecord;
};

const parseEnvelope = (
  value: unknown,
): Result<TransientActivationEnvelope, ActivationStoreError> => {
  if (value === undefined) return ok(emptyEnvelope());
  if (!isObject(value)) return err({ kind: "corrupt-envelope" });
  if (value.version !== 1) return err({ kind: "unsupported-version" });
  if (!isSequence(value.lastSequence) || !Array.isArray(value.tombstones))
    return err({ kind: "corrupt-envelope" });
  const tombstones: TransientInvalidationTombstone[] = [];
  for (const candidate of value.tombstones) {
    if (
      !isObject(candidate) ||
      !isTabId(candidate.tabId) ||
      !isSequence(candidate.seq)
    )
      return err({ kind: "corrupt-envelope" });
    tombstones.push(candidate as unknown as TransientInvalidationTombstone);
  }
  const record =
    value.record === undefined ? undefined : parseRecord(value.record);
  if (value.record !== undefined && record === undefined)
    return err({ kind: "corrupt-envelope" });
  return ok({
    version: 1,
    lastSequence: value.lastSequence,
    ...(record === undefined ? {} : { record }),
    tombstones,
  });
};

class Store implements TransientActivationStore {
  readonly #storage: TransientSessionStorage;
  readonly #listeners = new Set<
    (record: TransientActivationRecord | undefined) => void
  >();
  constructor(storage: TransientSessionStorage) {
    this.#storage = storage;
  }

  async readEnvelope(): Promise<
    Result<TransientActivationEnvelope, ActivationStoreError>
  > {
    try {
      return parseEnvelope(await this.#storage.get());
    } catch {
      return err({ kind: "storage-unavailable" });
    }
  }
  async #write(
    envelope: TransientActivationEnvelope,
  ): Promise<Result<void, ActivationStoreError>> {
    try {
      await this.#storage.set(envelope);
      for (const listener of this.#listeners) {
        try {
          listener(envelope.record);
        } catch {
          /* isolate consumer */
        }
      }
      return ok(undefined);
    } catch {
      return err({ kind: "storage-unavailable" });
    }
  }
  async read() {
    const result = await this.readEnvelope();
    return result.ok ? ok(result.value.record) : result;
  }
  async put(record: TransientActivationRecord) {
    const loaded = await this.readEnvelope();
    if (!loaded.ok) return loaded;
    const dominant = loaded.value.tombstones.find(
      (item) => item.tabId === record.tabId && item.seq > record.seq,
    );
    const next = {
      ...record,
      stage: dominant === undefined ? record.stage : ("invalidated" as const),
    };
    return this.#write({
      ...loaded.value,
      lastSequence: Math.max(
        loaded.value.lastSequence,
        record.seq,
      ) as ActivationSequence,
      record: next,
    });
  }
  async requestAdvance(
    activationId: ActivationId,
    stage: "received" | "activated",
  ): Promise<Result<void, ActivationStoreError>> {
    const loaded = await this.readEnvelope();
    if (!loaded.ok) return loaded;
    const record = loaded.value.record;
    if (record === undefined || record.activationId !== activationId)
      return err({ kind: "activation-not-found" });
    const valid =
      (record.stage === "pending" && stage === "received") ||
      (record.stage === "received" && stage === "activated");
    if (!valid) return err({ kind: "invalid-stage-transition" });
    return this.#write({ ...loaded.value, record: { ...record, stage } });
  }
  async invalidate(tombstone: TransientInvalidationTombstone) {
    const loaded = await this.readEnvelope();
    if (!loaded.ok) return loaded;
    const byTab = new Map(
      loaded.value.tombstones.map((item) => [item.tabId, item]),
    );
    const previous = byTab.get(tombstone.tabId);
    if (previous === undefined || previous.seq < tombstone.seq)
      byTab.set(tombstone.tabId, tombstone);
    const record = loaded.value.record;
    const nextRecord =
      record !== undefined &&
      record.tabId === tombstone.tabId &&
      tombstone.seq > record.seq
        ? { ...record, stage: "invalidated" as const }
        : record;
    return this.#write({
      ...loaded.value,
      lastSequence: Math.max(
        loaded.value.lastSequence,
        tombstone.seq,
      ) as ActivationSequence,
      ...(nextRecord === undefined ? {} : { record: nextRecord }),
      tombstones: [...byTab.values()],
    });
  }
  async authorizeAfterWatchReady(
    activationId: ActivationId,
  ): Promise<Result<ActivationAuthorization, ActivationStoreError>> {
    const loaded = await this.readEnvelope();
    if (!loaded.ok) return loaded;
    const record = loaded.value.record;
    if (record === undefined || record.activationId !== activationId)
      return err({ kind: "activation-not-found" });
    if (record.stage === "invalidated")
      return ok({ kind: "invalidated" as const, record });
    const advanced =
      record.stage === "pending"
        ? { ...record, stage: "received" as const }
        : record;
    const activated =
      advanced.stage === "received"
        ? { ...advanced, stage: "activated" as const }
        : advanced;
    if (activated.stage !== "activated")
      return err({ kind: "invalid-stage-transition" });
    const written = await this.#write({ ...loaded.value, record: activated });
    return written.ok
      ? ok({ kind: "authorized" as const, record: activated })
      : written;
  }
  async checkpoint(): Promise<Result<void, ActivationStoreError>> {
    const loaded = await this.readEnvelope();
    if (!loaded.ok) return loaded;
    const dominant =
      loaded.value.record === undefined ||
      loaded.value.record.stage === "invalidated"
        ? []
        : loaded.value.tombstones.filter(
            (item) =>
              item.tabId === loaded.value.record?.tabId &&
              item.seq > loaded.value.record.seq,
          );
    if (dominant.length > MAX_TRANSIENT_TOMBSTONES)
      return err({ kind: "capacity-exceeded" });
    const dominantKeys = new Set(
      dominant.map(({ tabId, seq }) => `${tabId}:${seq}`),
    );
    const remaining = [...loaded.value.tombstones]
      .filter(({ tabId, seq }) => !dominantKeys.has(`${tabId}:${seq}`))
      .sort((a, b) => b.seq - a.seq)
      .slice(0, MAX_TRANSIENT_TOMBSTONES - dominant.length);
    const keep = [...dominant, ...remaining];
    return this.#write({
      ...loaded.value,
      tombstones: keep.sort((a, b) => a.seq - b.seq),
    });
  }
  subscribe(
    listener: (record: TransientActivationRecord | undefined) => void,
  ): () => void {
    this.#listeners.add(listener);
    let active = true;
    return () => {
      if (active) {
        active = false;
        this.#listeners.delete(listener);
      }
    };
  }
}

export const createTransientActivationStore = (
  storage: TransientSessionStorage,
): TransientActivationStore => new Store(storage);

export interface TransientActivationScheduler {
  readonly store: TransientActivationStore;
  put(
    input: Omit<TransientActivationRecord, "seq" | "stage">,
  ): Promise<Result<void, ActivationStoreError>>;
  putAtSequence(
    input: Omit<TransientActivationRecord, "seq" | "stage">,
    seq: ActivationSequence,
  ): Promise<Result<void, ActivationStoreError>>;
  invalidate(tabId: TargetTabId): Promise<Result<void, ActivationStoreError>>;
  advance(
    activationId: ActivationId,
    stage: "received" | "activated",
  ): Promise<Result<void, ActivationStoreError>>;
  authorizeAfterWatchReady(
    activationId: ActivationId,
  ): Promise<Result<ActivationAuthorization, ActivationStoreError>>;
  checkpoint(): Promise<Result<void, ActivationStoreError>>;
}

class Scheduler implements TransientActivationScheduler {
  readonly store: TransientActivationStore;
  #tail: Promise<unknown> = Promise.resolve();
  constructor(store: TransientActivationStore) {
    this.store = store;
  }
  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation, operation);
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  async #next(): Promise<Result<ActivationSequence, ActivationStoreError>> {
    const loaded = await this.store.readEnvelope();
    if (!loaded.ok) return loaded;
    if (loaded.value.tombstones.length > MAX_TRANSIENT_TOMBSTONES) {
      const checkpoint = await this.store.checkpoint();
      if (!checkpoint.ok) return checkpoint;
    }
    const current = await this.store.readEnvelope();
    if (!current.ok) return current;
    const maximum = Math.max(
      current.value.lastSequence,
      current.value.record?.seq ?? 0,
      ...current.value.tombstones.map(({ seq }) => seq),
    );
    return ok((maximum + 1) as ActivationSequence);
  }
  put(input: Omit<TransientActivationRecord, "seq" | "stage">) {
    return this.#enqueue(async () => {
      const next = await this.#next();
      return next.ok
        ? this.store.put({ ...input, seq: next.value, stage: "pending" })
        : next;
    });
  }
  putAtSequence(
    input: Omit<TransientActivationRecord, "seq" | "stage">,
    sequence: ActivationSequence,
  ) {
    return this.#enqueue(() =>
      this.store.put({ ...input, seq: sequence, stage: "pending" }),
    );
  }
  invalidate(tabId: TargetTabId) {
    return this.#enqueue(async () => {
      const next = await this.#next();
      return next.ok ? this.store.invalidate({ tabId, seq: next.value }) : next;
    });
  }
  advance(id: ActivationId, stage: "received" | "activated") {
    return this.#enqueue(() => this.store.requestAdvance(id, stage));
  }
  authorizeAfterWatchReady(id: ActivationId) {
    return this.#enqueue(() => this.store.authorizeAfterWatchReady(id));
  }
  checkpoint() {
    return this.#enqueue(() => this.store.checkpoint());
  }
}

export const createTransientActivationScheduler = (
  store: TransientActivationStore,
): TransientActivationScheduler => new Scheduler(store);

export interface ChromeSessionArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}
export const createChromeTransientSessionStorage = (
  area: ChromeSessionArea,
): TransientSessionStorage => ({
  async get() {
    return (await area.get(TRANSIENT_ACTIVATION_STORAGE_KEY))[
      TRANSIENT_ACTIVATION_STORAGE_KEY
    ];
  },
  async set(value) {
    await area.set({ [TRANSIENT_ACTIVATION_STORAGE_KEY]: value });
  },
});
