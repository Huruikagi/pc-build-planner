import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { LanguageProvider } from "../../ui-language/public.js";
import { SETTINGS_IDENTIFIERS } from "./contracts.js";
import type { SettingsSectionHostRoot } from "./section-resources.js";
import { SettingsView } from "./view.js";

export type SettingsReactRoot = SettingsSectionHostRoot;

export function mountSettingsReactRoot(
  container: HTMLElement,
): SettingsReactRoot {
  const root = createRoot(container);
  try {
    flushSync(() => {
      root.render(
        <LanguageProvider>
          <SettingsView />
        </LanguageProvider>,
      );
    });
    const backupRestoreHost = container.querySelector<HTMLElement>(
      `[data-region="${SETTINGS_IDENTIFIERS.backupHost}"]`,
    );
    if (backupRestoreHost === null) {
      throw new Error("settings backup restore host is missing");
    }

    let unmounted = false;
    return {
      backupRestoreHost,
      unmount() {
        if (unmounted) return;
        unmounted = true;
        root.unmount();
      },
    };
  } catch (error) {
    root.unmount();
    throw error;
  }
}
