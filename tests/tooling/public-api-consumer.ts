import type { LocalDataRoot, Result } from "../../src/domain/public.js";
import type { CurrentBuildPublicApi } from "../../src/features/current-build/public.js";
import {
  type ApplicationApi,
  composeApplicationApi,
  type FeatureCompositionContext,
} from "../../src/index.js";
import type {
  DataWorkerRegistration,
  FoundationCommandDecoder,
  FoundationDataPort,
  FoundationRuntimeContribution,
  MaintenanceFence,
  MaintenanceSnapshotSource,
  RootMutationCommand,
} from "../../src/persistence/public.js";
import {
  createDataWorkerRegistration,
  createMaintenanceSnapshotSource,
  initializeProductionFoundationRuntimeContribution,
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

/** Downstream restore consumers replace the root, then release or abort the acquired fence. */
export const releaseAfterReplace = async (
  data: FoundationDataPort,
  fence: MaintenanceFence,
  candidate: unknown,
  assessment: Parameters<FoundationDataPort["replaceRoot"]>[0]["assessment"],
): ReturnType<FoundationDataPort["runMaintenance"]> => {
  const replaced = await data.replaceRoot({ candidate, assessment, fence });
  return data.runMaintenance(
    replaced.ok ? { type: "release", fence } : { type: "abort", fence },
  );
};

export const composeProductionFoundationRuntime = (): Promise<
  Result<FoundationRuntimeContribution, { readonly code: string }>
> => initializeProductionFoundationRuntimeContribution();

/** Downstream consumers compose the root API from the shell-provided context. */
export const composeShellRootApi = (
  context: FeatureCompositionContext,
): Result<ApplicationApi, { readonly kind: string }> =>
  composeApplicationApi(context);

/** Downstream consumers may reference canonical candidatePartId and quantity only. */
export const listAdoptedCandidateQuantities = async (
  currentBuild: CurrentBuildPublicApi,
  projectId: Parameters<CurrentBuildPublicApi["query"]["getByProject"]>[0],
): Promise<
  readonly { readonly candidatePartId: string; readonly quantity: number }[]
> => {
  const result = await currentBuild.query.getByProject(projectId);
  if (!result.ok || result.value.currentBuild === null) return [];
  return result.value.currentBuild.items.map((item) => ({
    candidatePartId: item.candidatePartId,
    quantity: item.quantity,
  }));
};
