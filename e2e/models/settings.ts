import type { Locator, Page } from "@playwright/test";

import type { SupportedLanguage } from "../../src/ui-messages/public.js";
import { featureRoot, navItem } from "./application-shell.js";
import { region } from "./locator-primitives.js";

/** Locates the persistent settings feature. */
export const settingsFeature = (page: Page): Locator =>
  featureRoot(page, "settings");

/** Locates the display-language switch control owned by settings. */
export const languageSelect = (page: Page): Locator =>
  region(settingsFeature(page), "language-select");

/** Locates the canonical backup/restore section hosted by settings. */
export const backupRestoreSection = (page: Page): Locator =>
  region(settingsFeature(page), "backup-restore-host");

/** Switches display language through the settings UI. */
export const selectLanguage = async (
  page: Page,
  language: SupportedLanguage,
): Promise<void> => {
  await navItem(page, "settings").click();
  await languageSelect(page).selectOption(language);
};

/** Locates the restore file control within any backup/restore surface. */
export const restoreFileControl = (scope: Locator | Page): Locator =>
  scope.locator('input[type="file"]');

/** Locates the restore file control inside the restore region. */
export const restoreFileInput = (restoreRegion: Locator): Locator =>
  restoreFileControl(restoreRegion);
