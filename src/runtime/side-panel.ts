import { createProductionSidePanelComposition } from "../application-shell/application-composition.js";
import type { LanguagePlatform } from "../ui-language/contracts.js";
import {
  createChromeLanguagePreferencePortIfAvailable,
  createInMemoryLanguagePreferencePort,
} from "../ui-language/preference-store.js";
import { startSidePanelWithLanguage } from "./side-panel-bootstrap.js";

const host = document.querySelector<HTMLElement>("#application-shell");
if (host === null) throw new Error("Application shell host is missing.");

/**
 * `chrome.storage`への到達は`preference-store.ts`だけに限る
 * （StorageAccessGuard, 3.2, 3.4）。このファイルが直接触れるChrome APIは
 * `chrome.i18n`のみである。Chrome APIが存在しない実行環境（DOMテスト）では、
 * 取得結果なしとメモリ保存の経路で動作する。
 */
const chromePreferences = createChromeLanguagePreferencePortIfAvailable();
const languagePlatform: LanguagePlatform =
  chromePreferences === undefined
    ? {
        preferences: createInMemoryLanguagePreferencePort(),
        browserUiLanguage: () => undefined,
      }
    : {
        preferences: chromePreferences,
        browserUiLanguage: () =>
          typeof chrome !== "undefined"
            ? chrome.i18n?.getUILanguage()
            : undefined,
      };

void startSidePanelWithLanguage({
  root: createProductionSidePanelComposition(host),
  document,
  lifecycleTarget: window,
  languagePlatform,
});
