// @ts-expect-error Chrome adapters are available only from the declared chrome subpath.
import { createChromeStorageAdapter } from "@pc-build-planner/local-data";
// @ts-expect-error Chrome storage structural types are available only from the chrome subpath.
import type { ChromeStorageApi } from "@pc-build-planner/local-data";
// @ts-expect-error Chrome lock structural types are available only from the chrome subpath.
import type { ChromeLocksApi } from "@pc-build-planner/local-data";
// @ts-expect-error Chrome adapters are not part of the generic backup subpath.
import { createChromeExclusiveLockAdapter } from "@pc-build-planner/local-data/backup";
// @ts-expect-error Chrome storage structural types are not part of the backup subpath.
import type { ChromeStorageApi as BackupChromeStorageApi } from "@pc-build-planner/local-data/backup";
// @ts-expect-error Chrome lock structural types are not part of the backup subpath.
import type { ChromeLocksApi as BackupChromeLocksApi } from "@pc-build-planner/local-data/backup";

void createChromeStorageAdapter;
void createChromeExclusiveLockAdapter;
type RootChromeTypes = ChromeStorageApi | ChromeLocksApi;
type BackupChromeTypes = BackupChromeStorageApi | BackupChromeLocksApi;
void (undefined as RootChromeTypes | BackupChromeTypes | undefined);
