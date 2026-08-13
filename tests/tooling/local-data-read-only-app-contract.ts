import type { CoreResult, LocalDataPolicy } from "@pc-build-planner/local-data";
import type { BackupCodec } from "@pc-build-planner/local-data/backup";
import type { ChromeStoragePort } from "@pc-build-planner/local-data/chrome";

import type {
  FoundationError,
  LocalDataRoot,
  MaintenanceState,
} from "../../src/domain/public.js";
import type {
  BackupArtifact,
  BackupDataV1,
  CurrentBackupEnvelope,
  RestoreInput,
  RestorePreview,
} from "../../src/features/backup-restore/contracts.js";
import type { RootOperation } from "../../src/persistence/public.js";

type ProductCorePolicy = LocalDataPolicy<
  LocalDataRoot,
  RootOperation,
  MaintenanceState,
  FoundationError
>;
type ProductChromeStorage = ChromeStoragePort<LocalDataRoot, MaintenanceState>;
type ProductBackupCodec = BackupCodec<
  LocalDataRoot,
  RestoreInput,
  unknown,
  CurrentBackupEnvelope,
  BackupDataV1,
  string,
  RestorePreview,
  FoundationError
>;

declare const corePolicy: ProductCorePolicy;
declare const chromeStorage: ProductChromeStorage;
declare const backupCodec: ProductBackupCodec;

const decodedRoot: CoreResult<LocalDataRoot, FoundationError> =
  corePolicy.decodeAndMigrate({});
const storedRoot = chromeStorage.writeRoot({} as LocalDataRoot);
const backupArtifact: CoreResult<string, FoundationError> = backupCodec.create(
  {} as LocalDataRoot,
);

void decodedRoot;
void storedRoot;
void backupArtifact;
void ({} as BackupArtifact);
