import { err, ok, type ProjectId } from "../domain/public.js";
import {
  decodeWithProfile,
  plainObject,
  uuid,
  z,
} from "../domain/runtime-schema/public.js";
import type {
  ProjectPreferenceError,
  ProjectPreferencePort,
  ProjectPreferenceRead,
} from "./contracts.js";

/*
 * 保存キーは `projectContextPreference` 一つだけ。canonical domain root と backup
 * 交換形式から分離した唯一の key であり、この file だけが知る（要件 8.1）。
 * 静的 gate が解決できるよう、get / set / remove の各呼び出し位置に文字列 literal を
 * 直接書き、変数・計算・alias 経由の key を作らない。
 */

/** 読み書きに必要な最小面だけを受ける。storage area 全体を渡さない。 */
export interface ProjectPreferenceStorageApi {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

const MISSING: ProjectPreferenceRead = { kind: "missing" };
const INVALID: ProjectPreferenceRead = { kind: "invalid" };
const STORAGE_UNAVAILABLE: ProjectPreferenceError = {
  kind: "storage-unavailable",
};
const STORAGE_WRITE_FAILED: ProjectPreferenceError = {
  kind: "storage-write-failed",
};

/**
 * version 1 document の strict schema（要件 8.2、8.3）。
 * 上流の設定済み runtime schema 入口だけを使い、schema instance も vendor issue も
 * この module の外へ出さない。宣言外の key、未知 version、非 UUID はすべて拒否する。
 */
const preferenceDocumentSchema = plainObject({
  version: z.literal(1),
  selectedProjectId: uuid<ProjectId>(),
});

/**
 * 未検証値を version 1 document として解釈する。失敗理由は一切公開せず、
 * 修復可能な `invalid` へ閉じる。未知 version も同じ path を通り、推測 migration を行わない。
 */
const interpretStoredValue = (stored: unknown): ProjectPreferenceRead => {
  if (stored === undefined) {
    return MISSING;
  }
  const decoded = decodeWithProfile(preferenceDocumentSchema, stored, {
    toError: () => INVALID,
  });
  return decoded.ok
    ? { kind: "valid", selectedProjectId: decoded.value.selectedProjectId }
    : INVALID;
};

/**
 * 専用 key 一件だけを操作する port（design: ProjectPreferenceStore）。
 * `src/ui-language/preference-store.ts` と同じ try/catch→Result の扱いに揃え、
 * 例外、保存値、project ID を error や log へ出さない。
 */
export const createProjectPreferencePort = (
  storage: ProjectPreferenceStorageApi,
): ProjectPreferencePort => ({
  async read() {
    let stored: Record<string, unknown>;
    try {
      stored = await storage.get("projectContextPreference");
    } catch {
      return err(STORAGE_UNAVAILABLE);
    }
    return ok(interpretStoredValue(stored.projectContextPreference));
  },

  async write(projectId: ProjectId) {
    try {
      // 保存する field は version と project ID だけ。名称、内容、draft、URL を含めない。
      await storage.set({
        projectContextPreference: { version: 1, selectedProjectId: projectId },
      });
      return ok(undefined);
    } catch {
      return err(STORAGE_WRITE_FAILED);
    }
  },

  async clear() {
    try {
      await storage.remove("projectContextPreference");
      return ok(undefined);
    } catch {
      return err(STORAGE_WRITE_FAILED);
    }
  },
});

/**
 * Chrome 拡張の実行環境でのみ実 port を返す。Chrome API が存在しない実行環境
 * （DOM test など）では `undefined` を返し、composition seam（`runtime.ts`）が
 * in-memory port へ fallback できるようにする。`chrome.storage` への到達点を
 * この file へ限定するため、存在確認もこの関数の内側で行う。
 */
export const createChromeProjectPreferencePortIfAvailable = ():
  | ProjectPreferencePort
  | undefined =>
  typeof chrome !== "undefined" && chrome.storage?.local !== undefined
    ? createProjectPreferencePort(chrome.storage.local)
    : undefined;

/**
 * test と非 Chrome 実行環境のための決定的な storage double。値は process 内 memory
 * にのみ保持し、instance 間で共有しない。専用 key 以外の key を持たない。
 */
const createInMemoryPreferenceStorage = (
  initialStoredValue?: unknown,
): ProjectPreferenceStorageApi => {
  let stored: unknown = initialStoredValue;
  return {
    async get(key) {
      return key === "projectContextPreference" && stored !== undefined
        ? { projectContextPreference: stored }
        : {};
    },
    async set(items) {
      if ("projectContextPreference" in items) {
        stored = items.projectContextPreference;
      }
    },
    async remove(key) {
      if (key === "projectContextPreference") {
        stored = undefined;
      }
    },
  };
};

/**
 * Chrome adapter と同じ port 契約を満たす決定的な in-memory 実装。
 * 未検証の保存値を初期状態として受け取れるため、missing / valid / invalid の
 * 解釈は Chrome adapter とまったく同じ decode path を通る。
 */
export const createInMemoryProjectPreferencePort = (
  initialStoredValue?: unknown,
): ProjectPreferencePort =>
  createProjectPreferencePort(
    createInMemoryPreferenceStorage(initialStoredValue),
  );
