import type { WorkerFeatureContribution } from "../../src/application-shell/feature-contribution-catalog.js";
import {
  type ApplicationFeatureRegistration,
  type FeatureId,
  isPersistent,
  type PersistentApplicationFeatureRegistration,
  parseTargetTabId,
  type TransientApplicationFeatureRegistration,
  type TransientGestureRegistrationPort,
  type TransientSurfaceLifecyclePort,
} from "../../src/application-shell/public.js";
import type { LocalDataRoot, Result } from "../../src/domain/public.js";
import type {
  CandidateDraft,
  CandidateEditorPrefill,
  CandidateManagementPublicApi,
  CandidateQuery,
  CandidateSourceCatalogPort,
  CandidateSourceMutationPort,
  CandidateSourceReference,
  UpdateCandidateInput,
} from "../../src/features/candidate-management/public.js";
import type { CurrentBuildPublicApi } from "../../src/features/current-build/public.js";
import type {
  ManufacturerDomainLookup,
  PagePriceExtractionError,
  ProductCapturePublicApi,
} from "../../src/features/product-capture/public.js";
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
  CURRENT_SCHEMA_VERSION,
  createDataWorkerRegistration,
  createMaintenanceSnapshotSource,
  initializeProductionFoundationRuntimeContribution,
} from "../../src/persistence/public.js";
import type {
  ProjectContextPublicApi,
  ProjectContextReadPort,
} from "../../src/project-context/public.js";
import {
  LanguageProvider,
  LanguageSelectControl,
} from "../../src/ui-language/public.js";
import type { MessageKey } from "../../src/ui-messages/public.js";

export const consumeUiLanguagePublicEntry = () => ({
  LanguageProvider,
  LanguageSelectControl,
});

/** Project-context consumer は read capability だけを受け取って現在 snapshot を読む。 */
export const readProjectContext = (
  context: ProjectContextReadPort,
): ReturnType<ProjectContextReadPort["getSnapshot"]> => context.getSnapshot();

export const consumeProjectContextCapabilities = (
  context: ProjectContextPublicApi,
) => ({
  snapshot: context.read.getSnapshot(),
  commands: context.commands,
  guards: context.guards,
  replacement: context.replacementGuard,
});

export const rejectProjectContextInternals = (
  context: ProjectContextPublicApi,
) => {
  // @ts-expect-error public facade never exposes the concrete service.
  void context.service;
  // @ts-expect-error read capability never grants selection commands.
  void context.read.select;
  // @ts-expect-error replacement owner cannot reach the selection port.
  void context.replacementGuard.commands;
};

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
  backupRestoreData: FoundationDataPort,
  transientSurface: TransientSurfaceLifecyclePort,
): Result<ApplicationApi, { readonly kind: string }> =>
  composeApplicationApi(context, { backupRestoreData, transientSurface });

export const rejectMissingTransientSurface = (
  context: FeatureCompositionContext,
  backupRestoreData: FoundationDataPort,
) =>
  // @ts-expect-error side-panel composition requires the real transient lifecycle seam
  composeApplicationApi(context, { backupRestoreData });

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

/** Candidate-management classifiers consume only product-capture's public lookup seam. */
export const consumeManufacturerDomainLookup = (
  capture: ProductCapturePublicApi,
  pageUrl: string,
): ReturnType<ManufacturerDomainLookup["findManufacturer"]> =>
  capture.manufacturerDomains.findManufacturer(pageUrl);

/**
 * The lookup is a read-only match seam: it exposes neither the map entries nor
 * any extraction, permission, or site-usage capability.
 */
export const rejectManufacturerDomainInternals = (
  lookup: ManufacturerDomainLookup,
) => {
  // @ts-expect-error the public lookup never exposes the map entries.
  void lookup.entries;
  // @ts-expect-error the public lookup never exposes the domain map itself.
  void lookup.domainMap;
  // @ts-expect-error the public lookup does not enable DOM extraction.
  void lookup.extract;
  // @ts-expect-error the public lookup does not decide host permissions.
  void lookup.requestPermission;
};

/** Source-price-refresh consumes the assembled price port without a deep import. */
export const consumePagePriceExtraction = async (
  capture: ProductCapturePublicApi,
  tabId: Parameters<
    ProductCapturePublicApi["pagePriceExtraction"]["extractPrice"]
  >[0],
) => {
  const result = await capture.pagePriceExtraction.extractPrice(tabId);
  if (!result.ok) {
    const failure: PagePriceExtractionError = result.error;
    return failure.kind;
  }
  return result.value.price?.confirmed;
};

/** Downstream source consumers need neither the storage root nor product values. */
export const consumeCandidateSources = async (
  catalog: CandidateSourceCatalogPort,
  mutations: CandidateSourceMutationPort,
  candidateId: Parameters<
    CandidateSourceCatalogPort["getSourceReference"]
  >[0]["candidateId"],
): Promise<readonly CandidateSourceReference[]> => {
  void mutations;
  const result = await catalog.listSourceReferences({ candidateId });
  return result.ok ? result.value : [];
};

export const mutateCandidateSourceWithoutAggregate = async (
  mutations: CandidateSourceMutationPort,
  input: Parameters<CandidateSourceMutationPort["setPrimarySource"]>[0],
) => {
  const result = await mutations.setPrimarySource(input);
  if (result.ok) {
    // @ts-expect-error mutation consumers cannot reach candidate product values
    void result.value.product;
  }
  return result;
};

export const inspectCanonicalCandidateDraft = (draft: CandidateDraft) => {
  void draft.sources;
  void draft.primarySourceId;
  // @ts-expect-error canonical draft has no legacy singleton source
  void draft.sourceInfo;
  // @ts-expect-error canonical product values have no shared price
  void draft.product.price;
};

export const inspectCanonicalQueryDraft = async (
  query: CandidateQuery,
  id: Parameters<CandidateQuery["getCandidateDraft"]>[0],
) => {
  const result = await query.getCandidateDraft(id);
  if (result.ok) {
    // @ts-expect-error public query does not expose singleton source metadata
    void result.value.sourceInfo;
    // @ts-expect-error public query does not expose shared product price
    void result.value.product.price;
  }
};

export const inspectCanonicalUpdate = (input: UpdateCandidateInput) => {
  // @ts-expect-error public update does not expose singleton source metadata
  void input.draft.sourceInfo;
  // @ts-expect-error public update does not expose shared product price
  void input.draft.product.price;
};

export const inspectCanonicalEditorIntent = (
  prefill: CandidateEditorPrefill,
) => {
  // @ts-expect-error pre-edit intent leaves project resolution to candidate management
  void prefill.draft.projectId;
};

/** Product capture consumes only the canonical public intent-factory facet. */
export const createUnresolvedCandidateEditorIntent = (
  factory: CandidateManagementPublicApi["createCandidateEditorIntent"],
) =>
  factory({
    draft: {
      category: "uncategorized",
      product: { name: { original: null, confirmed: "" } },
      normalizedAttributes: { category: "uncategorized" },
    },
  });

const publicFeatureBase = {
  publicApi: {},
  getAvailability: () => ({ status: "available" as const }),
  subscribeAvailability: () => () => undefined,
  mount: async () => ({ unmount: async () => undefined }),
};

export const publicPersistent: PersistentApplicationFeatureRegistration = {
  ...publicFeatureBase,
  id: "public-persistent" as FeatureId,
  presentation: "persistent",
  navigation: { labelKey: "Public" as MessageKey, order: 1 },
};

export const invalidWorkerCatalogEntry: WorkerFeatureContribution = {
  // @ts-expect-error worker-safe catalog entries cannot carry UI registrations
  registration: publicPersistent,
};

export const publicTransient: TransientApplicationFeatureRegistration = {
  ...publicFeatureBase,
  id: "public-transient" as FeatureId,
  presentation: "transient",
  transientActivation: {
    validate: (request) => ({ ok: true, value: request }),
    accept: async () => ({
      ok: true,
      value: { release: async () => undefined },
    }),
  },
};

// 公開consumerは現行保存schema版を公開入口の正規値としてだけ参照できる（4.6, 4.7）。
export const consumeCurrentSchemaVersion = (): number => CURRENT_SCHEMA_VERSION;

export const consumeTransientShellPorts = (
  feature: ApplicationFeatureRegistration,
  lifecycle: TransientSurfaceLifecyclePort,
  gestures: TransientGestureRegistrationPort,
) => ({
  navigation: isPersistent(feature) ? feature.navigation : null,
  lifecycle,
  gestures,
  tab: parseTargetTabId(1),
});

// @ts-expect-error persistent registrations require navigation
const invalidPersistent: PersistentApplicationFeatureRegistration = {
  ...publicFeatureBase,
  id: "invalid-persistent" as FeatureId,
  presentation: "persistent",
};
void invalidPersistent;

export const invalidTransient: TransientApplicationFeatureRegistration = {
  ...publicFeatureBase,
  id: "invalid-transient" as FeatureId,
  presentation: "transient",
  // @ts-expect-error transient registrations cannot expose navigation
  navigation: { labelKey: "Invalid" as MessageKey, order: 0 },
  transientActivation: publicTransient.transientActivation,
};
