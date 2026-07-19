import type {
  ApplicationCompositionRoot,
  ApplicationFeatureRegistration,
  ApplicationWorkerRegistration,
  FeatureId,
  MaintenanceProjection,
  MutationGate,
  PublicApiRegistry,
  ShellViewState,
  WorkerRegistrationContext,
} from "../../src/application-shell/contracts.js";
import type { Result } from "../../src/domain/public.js";
import type {
  MaintenanceSnapshot,
  MaintenanceSnapshotSource,
} from "../../src/persistence/public.js";

const featureId = "mock-feature" as FeatureId;

interface MockPublicApi {
  readonly inspect: () => string;
}

export const mockFeature: ApplicationFeatureRegistration<MockPublicApi> = {
  id: featureId,
  navigation: { label: "Mock feature", order: 1 },
  publicApi: { inspect: () => "ready" },
  getAvailability: () => ({ status: "available" }),
  subscribeAvailability: () => () => undefined,
  mount: async ({ operationPolicy, reportError }) => {
    if (!operationPolicy.isAllowed("read")) reportError("read unavailable");
    return { unmount: async () => undefined };
  },
};

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
