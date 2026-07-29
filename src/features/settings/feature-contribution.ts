import type { FeatureContribution } from "../../application-shell/public.js";
import type { BackupRestoreSectionMount } from "../backup-restore/public.js";
import {
  createSettingsFeatureRegistration,
  type SettingsPublicApi,
} from "./registration.js";

export const settingsContributionKey = "settings";

export type SettingsContribution = FeatureContribution<
  typeof settingsContributionKey,
  SettingsPublicApi
>;

export interface SettingsContributionDependencies {
  readonly backupRestore: BackupRestoreSectionMount;
}

export function createSettingsContribution(
  dependencies: SettingsContributionDependencies,
): SettingsContribution {
  return {
    key: settingsContributionKey,
    registration: createSettingsFeatureRegistration(dependencies),
  };
}
