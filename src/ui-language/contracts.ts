import type { Result } from "../domain/public.js";
import type { SupportedLanguage } from "../ui-messages/public.js";

/** `resolveInitialLanguage` の入力。ブラウザAPIを直接呼ばず、値として受け取る（8.3）。 */
export interface LanguageResolutionInput {
  readonly stored: unknown;
  readonly browserUiLanguage: unknown;
}

/** 表示言語専用の保存ポートの失敗。安定した英字コードのみとし、保存値は含めない。 */
export type LanguagePreferenceError =
  | { readonly code: "storage-unavailable" }
  | { readonly code: "storage-write-failed" };

/** 表示言語専用キー1つだけを読み書きする保存ポート。 */
export interface LanguagePreferencePort {
  read(): Promise<
    Result<SupportedLanguage | undefined, LanguagePreferenceError>
  >;
  write(
    language: SupportedLanguage,
  ): Promise<Result<void, LanguagePreferenceError>>;
}

/** 読み書きに必要な最小面だけを受ける。storage area 全体を渡さない。 */
export interface LanguagePreferenceStorageApi {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/** 現在の表示言語を保持し、購読者へ同期通知するReact外の単一ストア。 */
export interface LanguageStore {
  getSnapshot(): SupportedLanguage;
  subscribe(listener: (language: SupportedLanguage) => void): () => void;
  setLanguage(language: SupportedLanguage): void;
}

/** `initializeUiLanguage` が必要とする最小の環境面。 */
export interface LanguagePlatform {
  readonly preferences: LanguagePreferencePort;
  /** `chrome.i18n.getUILanguage()` の呼び出し結果。取得できない環境ではundefined。 */
  readonly browserUiLanguage: () => unknown;
}
