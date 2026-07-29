import type { FeatureId } from "../../application-shell/public.js";
import type { MessageKey } from "../../ui-messages/public.js";

export const settingsFeatureId = "settings" as FeatureId;

/** Semantic messages consumed by settings without owning catalog data. */
export const SETTINGS_MESSAGE_KEYS = {
  title: "settings.title",
  languageTitle: "settings.language.title",
  languageDescription: "settings.language.description",
  backupRestoreTitle: "settings.backupRestore.title",
  backupRestoreDescription: "settings.backupRestore.description",
  navigation: "nav.settings",
  loadingRecovery: "shell.settingsRecoveryLoading",
  startupFailureRecovery: "shell.settingsRecoveryStartupFailed",
} as const satisfies Readonly<Record<string, MessageKey>>;

/** Stable, language-independent hooks shared by DOM and E2E consumers. */
export const SETTINGS_IDENTIFIERS = {
  feature: "settings",
  pageRegion: "settings",
  languageRegion: "language",
  backupRegion: "backup-restore",
  backupHost: "backup-restore-host",
  languageSelectAction: "language-select",
} as const;
