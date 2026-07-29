import type { ReactElement } from "react";

import { LanguageSelectControl } from "../../ui-language/public.js";
import { useMessages } from "../../ui-messages/public.js";
import { SETTINGS_IDENTIFIERS, SETTINGS_MESSAGE_KEYS } from "./contracts.js";

export function SettingsView(): ReactElement {
  const messages = useMessages();
  return (
    <section className="settings" data-region={SETTINGS_IDENTIFIERS.pageRegion}>
      <h2>{messages(SETTINGS_MESSAGE_KEYS.title)}</h2>
      <section
        className="settings__section"
        data-region={SETTINGS_IDENTIFIERS.languageRegion}
      >
        <h3>{messages(SETTINGS_MESSAGE_KEYS.languageTitle)}</h3>
        <p>{messages(SETTINGS_MESSAGE_KEYS.languageDescription)}</p>
        <LanguageSelectControl />
      </section>
      <section
        className="settings__section"
        data-region={SETTINGS_IDENTIFIERS.backupRegion}
      >
        <h3>{messages(SETTINGS_MESSAGE_KEYS.backupRestoreTitle)}</h3>
        <p>{messages(SETTINGS_MESSAGE_KEYS.backupRestoreDescription)}</p>
        <div data-region={SETTINGS_IDENTIFIERS.backupHost} />
      </section>
    </section>
  );
}
