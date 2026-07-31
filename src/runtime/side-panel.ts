import { createProductionSidePanelComposition } from "../application-shell/application-composition.js";
import { createProductionLanguagePlatform } from "../ui-language/runtime.js";
import { createProductionTransientPanelIntegration } from "./production-transient-panel.js";
import { startSidePanelWithLanguage } from "./side-panel-bootstrap.js";
import { resolveChromeTransientPanelStorage } from "./transient-activation-store.js";

const host = document.querySelector<HTMLElement>("#application-shell");
if (host === null) throw new Error("Application shell host is missing.");

const languagePlatform = createProductionLanguagePlatform();

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
              onActivationAccepted: notices.activationAccepted,
              onActivationExpired: notices.activationExpired,
              reportError: (code) => console.error(`transient-panel: ${code}`),
            }),
        })
      : createProductionSidePanelComposition(host),
  document,
  lifecycleTarget: window,
  languagePlatform,
});
