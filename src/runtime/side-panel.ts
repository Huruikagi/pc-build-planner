import { createProductionSidePanelComposition } from "../application-shell/application-composition.js";
import {
  createChromeLanguagePreferencePortIfAvailable,
  createInMemoryLanguagePreferencePort,
  type LanguagePlatform,
} from "../ui-language/runtime.js";
import { createProductionTransientPanelIntegration } from "./production-transient-panel.js";
import { startSidePanelWithLanguage } from "./side-panel-bootstrap.js";
import { resolveChromeTransientPanelStorage } from "./transient-activation-store.js";

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

const transientStorage = resolveChromeTransientPanelStorage();

void startSidePanelWithLanguage({
  root:
    transientStorage &&
    typeof chrome !== "undefined" &&
    chrome.tabs &&
    chrome.runtime
      ? createProductionSidePanelComposition(host, {
          createTransientMonitoring: (controller, notices) =>
            createProductionTransientPanelIntegration({
              session: transientStorage.session,
              changes: transientStorage.changes,
              tabs: chrome.tabs,
              runtime: chrome.runtime,
              controller,
              onSessionReadFailed: notices.sessionReadFailed,
              onSessionReadSucceeded: notices.sessionReadSucceeded,
              reportError: (code) => console.error(`transient-panel: ${code}`),
            }),
        })
      : createProductionSidePanelComposition(host),
  document,
  lifecycleTarget: window,
  languagePlatform,
});
