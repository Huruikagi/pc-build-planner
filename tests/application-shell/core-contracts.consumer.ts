import type {
  ApplicationCompositionRoot,
  ApplicationFeatureRegistration,
  ApplicationWorkerRegistration,
  FeatureId,
  MaintenanceProjection,
  MutationGate,
  PersistentApplicationFeatureRegistration,
  PublicApiRegistry,
  ShellViewState,
  TransientApplicationFeatureRegistration,
  WorkerRegistrationContext,
} from "../../src/application-shell/contracts.js";
import { isPersistent } from "../../src/application-shell/contracts.js";
import type {
  TransientGestureRegistrationPort,
  TransientSurfaceLifecyclePort,
} from "../../src/application-shell/transient-surface-ports.js";
import { parseTargetTabId } from "../../src/application-shell/transient-surface-ports.js";
import type { Result } from "../../src/domain/public.js";
import type {
  MaintenanceSnapshot,
  MaintenanceSnapshotSource,
} from "../../src/persistence/public.js";
import type { MessageKey } from "../../src/ui-messages/public.js";

const featureId = "mock-feature" as FeatureId;

interface MockPublicApi {
  readonly inspect: () => string;
}

export const mockFeature: ApplicationFeatureRegistration<MockPublicApi> = {
  id: featureId,
  presentation: "persistent",
  navigation: { labelKey: "Mock feature" as MessageKey, order: 1 },
  publicApi: { inspect: () => "ready" },
  getAvailability: () => ({ status: "available" }),
  subscribeAvailability: () => () => undefined,
  mount: async ({ operationPolicy, reportError }) => {
    if (!operationPolicy.isAllowed("read")) reportError("read unavailable");
    return { unmount: async () => undefined };
  },
};

export const mockTransientFeature: TransientApplicationFeatureRegistration<MockPublicApi> =
  {
    id: "mock-transient" as FeatureId,
    presentation: "transient",
    publicApi: { inspect: () => "transient" },
    getAvailability: () => ({ status: "available" }),
    subscribeAvailability: () => () => undefined,
    mount: async () => ({ unmount: async () => undefined }),
  };

export const readPersistentNavigation = (
  feature: ApplicationFeatureRegistration,
): MessageKey | null =>
  isPersistent(feature) ? feature.navigation.labelKey : null;

const invalidTransient: TransientApplicationFeatureRegistration = {
  id: "invalid-transient" as FeatureId,
  presentation: "transient",
  // @ts-expect-error transient registrations cannot expose navigation
  navigation: { labelKey: "Invalid" as MessageKey, order: 0 },
  publicApi: {},
  getAvailability: () => ({ status: "available" }),
  subscribeAvailability: () => () => undefined,
  mount: async () => ({ unmount: async () => undefined }),
};
void invalidTransient;

// @ts-expect-error persistent registrations require navigation metadata
const invalidPersistent: PersistentApplicationFeatureRegistration = {
  id: "invalid-persistent" as FeatureId,
  presentation: "persistent",
  publicApi: {},
  getAvailability: () => ({ status: "available" }),
  subscribeAvailability: () => () => undefined,
  mount: async () => ({ unmount: async () => undefined }),
};
void invalidPersistent;

export const acceptTransientPorts = (
  lifecycle: TransientSurfaceLifecyclePort,
  gestures: TransientGestureRegistrationPort,
) => ({ lifecycle, gestures, parsedTab: parseTargetTabId(1) });

export const mockWorker: ApplicationWorkerRegistration = {
  id: featureId,
  register(context: WorkerRegistrationContext) {
    const unregister = context.addActionHandler(
      featureId,
      async () => undefined,
    );
    return { ok: true, value: unregister };
  },
};

export const projectFoundationMaintenance = (
  source: MaintenanceSnapshotSource,
  projection: MaintenanceProjection,
): Promise<Result<MaintenanceSnapshot, unknown>> =>
  source.getSnapshot().then((result) => {
    if (result.ok) projection.accept(result.value);
    return result;
  });

export const describeGate = (
  gate: MutationGate,
): readonly [boolean, boolean] => [
  gate.isAllowed("read"),
  gate.isAllowed("mutation"),
];

export const readyView: ShellViewState = { kind: "ready", selected: featureId };

type RootEntries = { readonly mock: MockPublicApi };

export const composeMockApi = (
  registry: PublicApiRegistry<RootEntries>,
): Readonly<RootEntries> => registry.compose({ mock: mockFeature.publicApi });

export const composeMockEntries = (registry: PublicApiRegistry<RootEntries>) =>
  registry.composeEntries([
    { key: "mock", publicApi: mockFeature.publicApi },
    { key: "health", publicApi: { status: () => "ready" as const } },
  ] as const);

export const readTypedEntryRoot = (
  result: ReturnType<typeof composeMockEntries>,
): readonly [string, "ready"] | null =>
  result.ok
    ? [result.value.mock.inspect(), result.value.health.status()]
    : null;

export const startMockRoot = (
  root: ApplicationCompositionRoot<Readonly<RootEntries>>,
) => root.start();
