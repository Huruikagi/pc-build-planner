import type {
  ApplicationFeatureRegistration,
  Availability,
  FeatureId,
  FeatureMountContext,
  FeatureMountHandle,
} from "../../application-shell/public.js";
import type { FoundationDataPort } from "../../persistence/public.js";
import { fileGateway } from "./file-gateway.js";
import { mountBackupRestoreReactRoot } from "./react-root.js";
import { createBackupService, createRestoreService } from "./service.js";
import { type BackupRestoreState, createBackupRestoreState } from "./state.js";

export const backupRestoreFeatureId = "backupRestore" as FeatureId;

/** 他featureへ公開する契約を持たない。バックアップ・復元はfeature内で完結する。 */
export type BackupRestorePublicApi = Record<string, never>;

export interface BackupRestoreFeatureRegistrationDependencies {
  readonly data: FoundationDataPort;
  readonly getAvailability?: () => Availability;
  readonly subscribeAvailability?: (
    listener: (availability: Availability) => void,
  ) => () => void;
  /** テスト・合成専用の上書き。未指定時はdataとDOM FileGatewayから構成する。 */
  readonly state?: BackupRestoreState;
}

/** 唯一の入口。application shellだけがこのfactoryを呼びfeatureを合成する。 */
export const createBackupRestoreFeatureRegistration = (
  dependencies: BackupRestoreFeatureRegistrationDependencies,
): ApplicationFeatureRegistration<BackupRestorePublicApi> => {
  const getAvailability =
    dependencies.getAvailability ?? (() => ({ status: "available" as const }));
  const subscribeAvailability =
    dependencies.subscribeAvailability ?? (() => () => {});

  return {
    id: backupRestoreFeatureId,
    navigation: { labelKey: "nav.backupRestore", order: 60, icon: "archive" },
    publicApi: {},
    getAvailability,
    subscribeAvailability,
    async mount(context: FeatureMountContext): Promise<FeatureMountHandle> {
      const state =
        dependencies.state ??
        createBackupRestoreState({
          backupService: createBackupService({ data: dependencies.data }),
          restoreService: createRestoreService({ data: dependencies.data }),
          fileGateway,
        });
      const root = mountBackupRestoreReactRoot(context.container, state);
      let unmounted = false;
      return {
        async unmount() {
          if (unmounted) return;
          unmounted = true;
          root.unmount();
        },
      };
    },
  };
};
