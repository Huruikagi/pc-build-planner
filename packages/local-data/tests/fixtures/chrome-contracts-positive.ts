import {
  createChromeExclusiveLockAdapter,
  createChromeStorageAdapter,
  type ChromeLocksApi,
  type ChromeStorageApi,
  type ChromeStorageKeyScope,
  type ChromeStoragePort,
} from "@pc-build-planner/local-data/chrome";

type Root = Readonly<{ revision: number; value: string }>;
type Control = Readonly<{ owner: string | null }>;

declare const storageApi: ChromeStorageApi;
declare const locksApi: ChromeLocksApi;
declare const keys: ChromeStorageKeyScope;

const storage: Promise<
  import("@pc-build-planner/local-data").CoreResult<
    ChromeStoragePort<Root, Control>,
    import("@pc-build-planner/local-data").StorageError
  >
> = createChromeStorageAdapter<Root, Control>(storageApi, keys);
const lock: import("@pc-build-planner/local-data").ExclusiveLockPort =
  createChromeExclusiveLockAdapter(locksApi, "synthetic-root-lock");

void storage;
void lock;

