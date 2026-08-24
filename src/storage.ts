/**
 * ルート単位の原子的な読み書き。`docs/reverse/features.md` 6.2 の性質を
 * 満たす最小の実装を意図している。
 *
 * 満たすもの: 原子性 / 単一書き込み権限 / スキーマ検証 / 破損検出 / 移行の余地。
 * 満たすために持ち込まないもの: トランザクションランナー、書き込み権限の
 * オブジェクト化、ルートロック、回復制御、参照修復ポリシー。
 * これらが v0.4.0 で 23 ファイルに膨らんだ当の対象なので、必要が実証される
 * まで足さないこと。
 */
import {
  createInitialRoot,
  type LocalDataRoot,
  localDataRootSchema,
} from "./model.js";

const STORAGE_KEY = "localDataRoot";

export type StorageFailure =
  | { readonly kind: "unavailable" }
  | { readonly kind: "corrupt" };

export type StorageResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: StorageFailure };

/** 差し替え可能な保存先。拡張では chrome.storage、dev harness ではメモリ。 */
export interface StorageDriver {
  read(): Promise<unknown>;
  write(root: LocalDataRoot): Promise<void>;
}

export const chromeStorageDriver: StorageDriver = {
  async read() {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    return stored[STORAGE_KEY];
  },
  async write(root) {
    await chrome.storage.local.set({ [STORAGE_KEY]: root });
  },
};

export const createMemoryStorageDriver = (
  seed?: LocalDataRoot,
): StorageDriver => {
  let current: unknown = seed;
  return {
    async read() {
      return current;
    },
    async write(root) {
      current = structuredClone(root);
    },
  };
};

export class Store {
  readonly #driver: StorageDriver;
  /** 書き込みを直列化する。これが単一書き込み権限の実体。 */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(driver: StorageDriver) {
    this.#driver = driver;
  }

  async read(): Promise<StorageResult<LocalDataRoot>> {
    let raw: unknown;
    try {
      raw = await this.#driver.read();
    } catch {
      return { ok: false, error: { kind: "unavailable" } };
    }
    /** 未初期化は正常。破損と区別する。 */
    if (raw === undefined) return { ok: true, value: createInitialRoot() };

    const parsed = localDataRootSchema.safeParse(raw);
    /**
     * 破損・非対応形式は検出して知らせるところまでが責務。復旧手段は持たない
     * (`features.md` 6.3)。既存データには触れない。
     */
    if (!parsed.success) return { ok: false, error: { kind: "corrupt" } };
    return { ok: true, value: parsed.data };
  }

  /**
   * 読み込み・変換・書き込みを 1 つのキューへ載せる。`mutate` が投げた場合は
   * 書き込まないので、保存済みデータは変更されない。
   */
  async mutate(
    mutate: (current: LocalDataRoot) => LocalDataRoot,
  ): Promise<StorageResult<LocalDataRoot>> {
    const run = this.#queue.then(
      async (): Promise<StorageResult<LocalDataRoot>> => {
        const current = await this.read();
        if (!current.ok) return current;

        const next: LocalDataRoot = {
          ...mutate(current.value),
          revision: current.value.revision + 1,
        };
        try {
          await this.#driver.write(next);
        } catch {
          return { ok: false, error: { kind: "unavailable" } };
        }
        return { ok: true, value: next };
      },
    );
    /** 失敗しても後続を止めない。 */
    this.#queue = run.catch(() => undefined);
    return run;
  }
}
