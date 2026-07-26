import type { LanguageStore } from "./contracts.js";
import { uiLanguageStore } from "./store.js";

/**
 * 文書の言語属性を現在の表示言語へ一致させ続ける。呼び出し直後に属性を
 * 現在の言語へ設定し、以後の変更へ追随する購読を開始する。返り値は
 * 購読解除関数である（5.1, 5.2）。
 */
export const syncDocumentLanguage = (
  document: Pick<Document, "documentElement">,
  store: LanguageStore = uiLanguageStore,
): (() => void) => {
  document.documentElement.lang = store.getSnapshot();
  return store.subscribe((language) => {
    document.documentElement.lang = language;
  });
};
