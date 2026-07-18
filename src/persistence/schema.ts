import type { Revision } from "../domain/identifiers.js";
import type { LocalDataRoot, MaintenanceGeneration } from "../domain/model.js";

export const CURRENT_SCHEMA_VERSION = 1 as const;
export const LOCAL_DATA_STORAGE_KEY = "localDataRoot" as const;
export const INITIAL_REVISION = 0 as Revision;
export const INITIAL_MAINTENANCE_GENERATION = 0 as MaintenanceGeneration;
export const REQUEST_DEDUPE_LIMIT = 100 as const;

export const createInitialRoot = (): LocalDataRoot => ({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  revision: INITIAL_REVISION,
  projects: [],
  candidateParts: [],
  currentBuilds: [],
  requestDedupe: [],
  maintenance: {
    generation: INITIAL_MAINTENANCE_GENERATION,
    active: false,
  },
});
