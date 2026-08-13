export { createChromeStorageAdapter } from "./storage-adapter.js";
export type {
  ChromeStorageApi,
  ChromeStorageChange,
  ChromeStorageChangeEvent,
  ChromeStorageKeyScope,
  ChromeStorageLocalApi,
  ChromeStoragePort,
  ScopedStorageChange,
} from "./storage-adapter.js";

export { createChromeExclusiveLockAdapter } from "./locks-adapter.js";
export type { ChromeLocksApi } from "./locks-adapter.js";
