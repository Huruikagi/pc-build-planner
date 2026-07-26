import {
  SOURCE_LANGUAGE,
  type SupportedLanguage,
} from "../ui-messages/public.js";
import type {
  LanguagePlatform,
  LanguagePreferencePort,
  LanguageStore as LanguageStoreContract,
} from "./contracts.js";
import { resolveInitialLanguage } from "./resolve.js";

type Listener = (language: SupportedLanguage) => void;

/**
 * 初期化前のシードはソース言語とする。上流の既定resolverと一致し、
 * Provider未設置・未初期化のDOMテストの前提を壊さないためである。
 * 製品としての初期値は必ず`initializeUiLanguage`が決定する。
 */
let current: SupportedLanguage = SOURCE_LANGUAGE;
let preferences: LanguagePreferencePort | undefined;
let initializePromise: Promise<void> | undefined;
const listeners = new Set<Listener>();

/** 値の変更と同期通知だけを行う。永続化は呼び出し側の責務。 */
const commit = (language: SupportedLanguage): void => {
  if (language === current) return;
  current = language;
  for (const listener of listeners) listener(current);
};

/** 6本のReact rootが共有する単一インスタンス。 */
export const uiLanguageStore: LanguageStoreContract = {
  getSnapshot: () => current,

  subscribe: (listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  setLanguage: (language) => {
    // 同値設定では通知も保存も行わない。
    if (language === current) return;
    commit(language);
    // 保存は非同期に追随させる。失敗しても値は巻き戻さない（3.5）。
    void preferences?.write(language);
  },
};

/**
 * 起動時に一度だけ呼ぶ。同期取得できるブラウザ表示言語で即座に確定させた
 * うえで、保存値の読み取り結果があればそれで置き換える。解決の完了は
 * Promiseとして返し、シェル起動はこれを待つ。二度目以降の呼び出しは
 * 既存の解決結果をそのまま返し、明示的な選択を上書きしない（2.6）。
 */
export const initializeUiLanguage = (
  platform: LanguagePlatform,
): Promise<SupportedLanguage> => {
  if (initializePromise === undefined) {
    preferences = platform.preferences;
    initializePromise = (async () => {
      commit(
        resolveInitialLanguage({
          stored: undefined,
          browserUiLanguage: platform.browserUiLanguage(),
        }),
      );
      const stored = await platform.preferences.read();
      if (stored.ok && stored.value !== undefined) commit(stored.value);
    })();
  }
  // Read `current` only after the (possibly already-settled) resolution
  // promise settles, so a second call reflects any explicit selection made
  // since the first call resolved rather than the stale first-resolution value.
  return initializePromise.then(() => current);
};

/** テスト専用。ストアを初期状態へ戻す。`--test-isolation=none`下での状態漏れを防ぐ。 */
export const resetUiLanguageForTest = (): void => {
  current = SOURCE_LANGUAGE;
  preferences = undefined;
  initializePromise = undefined;
  listeners.clear();
};
