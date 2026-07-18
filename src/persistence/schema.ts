import type { Revision } from "../domain/identifiers.js";

export const CURRENT_SCHEMA_VERSION = 1 as const;
export const LOCAL_DATA_STORAGE_KEY = "localDataRoot" as const;
export const INITIAL_REVISION = 0 as Revision;

export interface InitialLocalDataRoot {
  readonly schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  readonly revision: Revision;
}

export const createInitialRoot = (): InitialLocalDataRoot => ({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  revision: INITIAL_REVISION,
});
