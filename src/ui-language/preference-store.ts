import { err, ok } from "../domain/public.js";
import type { SupportedLanguage } from "../ui-messages/public.js";
import type {
  LanguagePreferenceError,
  LanguagePreferencePort,
  LanguagePreferenceStorageApi,
} from "./contracts.js";
import { normalizeLanguageTag } from "./resolve.js";

/**
 * 表示言語専用の保存キー。`localDataRoot` とは別のルート外キーであり、この
 * ファイルだけが知る。他モジュールへ引数として渡さない（保存先の判断は
 * design.mdを参照。local data foundationのwrite authorityを経由しない）。
 */
const STORAGE_KEY = "uiLanguage";

/** `src/persistence/chrome-storage-adapter.ts` と同じtry/catch→Resultの扱いに揃える。 */
export const createLanguagePreferencePort = (
  storage: LanguagePreferenceStorageApi,
): LanguagePreferencePort => ({
  async read() {
    let stored: Record<string, unknown>;
    try {
      stored = await storage.get(STORAGE_KEY);
    } catch {
      return err<LanguagePreferenceError>({ code: "storage-unavailable" });
    }
    // 解釈できない値は保存値なしと同じ結果へ落とす。normalizeLanguageTagは
    // 未対応言語・空文字・非文字列のいずれもundefinedへ正規化する。
    return ok(normalizeLanguageTag(stored[STORAGE_KEY]));
  },

  async write(language: SupportedLanguage) {
    try {
      await storage.set({ [STORAGE_KEY]: language });
      return ok(undefined);
    } catch {
      return err<LanguagePreferenceError>({ code: "storage-write-failed" });
    }
  },
});

/**
 * Chrome拡張の実行環境でのみ実ポートを返す。Chrome APIが存在しない実行環境
 * （DOMテストなど）では`undefined`を返し、呼び出し側がインメモリ実装へ
 * フォールバックできるようにする。`chrome.storage`への到達点をこのファイルへ
 * 限定するため、存在確認もこの関数の内側で行う（StorageAccessGuard, 3.2, 3.4）。
 */
export const createChromeLanguagePreferencePortIfAvailable = ():
  | LanguagePreferencePort
  | undefined =>
  typeof chrome !== "undefined" && chrome.storage?.local !== undefined
    ? createLanguagePreferencePort(chrome.storage.local)
    : undefined;

/** テストと非Chrome実行環境のための実装。値はプロセス内メモリにのみ保持する。 */
export const createInMemoryLanguagePreferencePort = (
  initial?: SupportedLanguage,
): LanguagePreferencePort => {
  let stored: SupportedLanguage | undefined = initial;
  return {
    async read() {
      return ok(stored);
    },
    async write(language: SupportedLanguage) {
      stored = language;
      return ok(undefined);
    },
  };
};
