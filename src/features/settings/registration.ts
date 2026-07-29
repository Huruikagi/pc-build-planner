import type {
  Availability,
  FeatureMountContext,
  FeatureMountHandle,
  PersistentApplicationFeatureRegistration,
} from "../../application-shell/public.js";
import type { BackupRestoreSectionMount } from "../backup-restore/public.js";
import { settingsFeatureId } from "./contracts.js";
import { mountSettingsReactRoot } from "./react-root.js";
import { mountSettingsSectionResources } from "./section-resources.js";

export type SettingsPublicApi = Record<string, never>;

export interface SettingsRegistrationDependencies {
  readonly backupRestore: BackupRestoreSectionMount;
  readonly getAvailability?: () => Availability;
  readonly subscribeAvailability?: (
    listener: (availability: Availability) => void,
  ) => () => void;
}

export function createSettingsFeatureRegistration(
  dependencies: SettingsRegistrationDependencies,
): PersistentApplicationFeatureRegistration<SettingsPublicApi> {
  return {
    id: settingsFeatureId,
    presentation: "persistent",
    navigation: { labelKey: "nav.settings", order: 60, icon: "settings" },
    publicApi: {},
    getAvailability:
      dependencies.getAvailability ?? (() => ({ status: "available" })),
    subscribeAvailability:
      dependencies.subscribeAvailability ?? (() => () => {}),
    async mount(context: FeatureMountContext): Promise<FeatureMountHandle> {
      const root = mountSettingsReactRoot(context.container);
      return mountSettingsSectionResources(
        root,
        dependencies.backupRestore,
        context,
      );
    },
  };
}
