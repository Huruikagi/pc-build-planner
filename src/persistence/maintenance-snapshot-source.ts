import type { Revision } from "../domain/identifiers.js";
import type { MaintenanceGeneration } from "../domain/model.js";
import type { FoundationError, Result } from "../domain/result.js";
import type { LocalDataRepository } from "./repository.js";
import { LOCAL_DATA_STORAGE_KEY } from "./schema.js";

export interface MaintenanceSnapshot {
  readonly generation: MaintenanceGeneration;
  readonly revision: Revision;
  readonly active: boolean;
}

export interface MaintenanceSnapshotSource {
  getSnapshot(): Promise<Result<MaintenanceSnapshot, FoundationError>>;
  subscribe(listener: (snapshot: MaintenanceSnapshot) => void): () => void;
}

export interface StorageChangeEvent {
  addListener(
    listener: (
      changes: Readonly<Record<string, unknown>>,
      areaName: string,
    ) => void,
  ): void;
  removeListener(
    listener: (
      changes: Readonly<Record<string, unknown>>,
      areaName: string,
    ) => void,
  ): void;
}

export interface MaintenanceSnapshotSourceDependencies {
  readonly repository: LocalDataRepository;
  readonly changes: StorageChangeEvent;
  readonly reportError: (error: FoundationError) => void;
}

const storageUnavailable = (): FoundationError => ({
  code: "storage-unavailable",
});

class DefaultMaintenanceSnapshotSource implements MaintenanceSnapshotSource {
  readonly #repository: LocalDataRepository;
  readonly #changes: StorageChangeEvent;
  readonly #reportError: (error: FoundationError) => void;

  constructor(dependencies: MaintenanceSnapshotSourceDependencies) {
    this.#repository = dependencies.repository;
    this.#changes = dependencies.changes;
    this.#reportError = dependencies.reportError;
  }

  async getSnapshot(): Promise<Result<MaintenanceSnapshot, FoundationError>> {
    try {
      const root = await this.#repository.readRoot();
      if (!root.ok) return root;
      return {
        ok: true,
        value: {
          generation: root.value.maintenance.generation,
          revision: root.value.revision,
          active: root.value.maintenance.active,
        },
      };
    } catch {
      return { ok: false, error: storageUnavailable() };
    }
  }

  subscribe(listener: (snapshot: MaintenanceSnapshot) => void): () => void {
    let active = true;
    const onChanged = (
      changes: Readonly<Record<string, unknown>>,
      areaName: string,
    ): void => {
      if (areaName !== "local" || !(LOCAL_DATA_STORAGE_KEY in changes)) return;
      void this.#notify(listener, () => active);
    };
    this.#changes.addListener(onChanged);
    return () => {
      if (!active) return;
      active = false;
      this.#changes.removeListener(onChanged);
    };
  }

  async #notify(
    listener: (snapshot: MaintenanceSnapshot) => void,
    isActive: () => boolean,
  ): Promise<void> {
    const snapshot = await this.getSnapshot();
    if (!isActive()) return;
    if (snapshot.ok) listener(snapshot.value);
    else this.#reportError(snapshot.error);
  }
}

export const createMaintenanceSnapshotSource = (
  dependencies: MaintenanceSnapshotSourceDependencies,
): MaintenanceSnapshotSource =>
  new DefaultMaintenanceSnapshotSource(dependencies);
