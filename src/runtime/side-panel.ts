import { createProductionSidePanelComposition } from "../application-shell/application-composition.js";
import type { LanguagePlatform } from "../ui-language/contracts.js";
import {
  createInMemoryLanguagePreferencePort,
  createLanguagePreferencePort,
} from "../ui-language/preference-store.js";
import { startSidePanelWithLanguage } from "./side-panel-bootstrap.js";

const host = document.querySelector<HTMLElement>("#application-shell");
if (host === null) throw new Error("Application shell host is missing.");

/**
 * Chrome APIへの直接参照は本ファイルと `preference-store.ts` に限る。Chrome
 * APIが存在しない実行環境（DOMテスト）では、取得結果なしとメモリ保存の経路で
 * 動作する。
 */
const languagePlatform: LanguagePlatform =
  typeof chrome !== "undefined" && chrome.storage?.local !== undefined
    ? {
        preferences: createLanguagePreferencePort(chrome.storage.local),
        browserUiLanguage: () => chrome.i18n?.getUILanguage(),
      }
    : {
        preferences: createInMemoryLanguagePreferencePort(),
        browserUiLanguage: () => undefined,
      };

void startSidePanelWithLanguage({
  root: createProductionSidePanelComposition(host),
  document,
  lifecycleTarget: window,
  languagePlatform,
});
