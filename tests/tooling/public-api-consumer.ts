import type { LocalDataRoot, Result } from "../../src/domain/public.js";
import type {
  DataWorkerRegistration,
  FoundationCommandDecoder,
  FoundationDataPort,
  MaintenanceSnapshotSource,
  RootMutationCommand,
} from "../../src/persistence/public.js";
import {
  createDataWorkerRegistration,
  createMaintenanceSnapshotSource,
} from "../../src/persistence/public.js";

export interface MockFoundationConsumer {
  readonly data: FoundationDataPort;
  inspect(): Promise<Result<LocalDataRoot, { readonly code: string }>>;
  save(command: RootMutationCommand): ReturnType<FoundationDataPort["mutate"]>;
}

export const composePublicRuntime = (
  data: FoundationDataPort,
  decoder: FoundationCommandDecoder,
): DataWorkerRegistration =>
  createDataWorkerRegistration({
    data,
    decoder,
    restrictAccess: async () => ({ ok: true, value: undefined }),
    authorize: (caller) => caller.kind === "trusted-extension",
  });

export const observeMaintenance = (
  source: MaintenanceSnapshotSource,
): ReturnType<MaintenanceSnapshotSource["getSnapshot"]> => source.getSnapshot();

export const composeMaintenanceSource = (
  ...dependencies: Parameters<typeof createMaintenanceSnapshotSource>
): MaintenanceSnapshotSource =>
  createMaintenanceSnapshotSource(...dependencies);
