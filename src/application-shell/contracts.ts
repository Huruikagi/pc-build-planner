import type { Result } from "../domain/public.js";
import type {
  MaintenanceSnapshot as FoundationMaintenanceSnapshot,
  MaintenanceSnapshotSource,
} from "../persistence/public.js";

export type FeatureId = string & { readonly __brand: "FeatureId" };

export type OperationKind = "read" | "mutation";

export type Availability =
  | { readonly status: "available" }
  | { readonly status: "unavailable"; readonly reason: string };

export interface OperationPolicy {
  isAllowed(kind: OperationKind): boolean;
}

export interface FeatureMountContext {
  readonly container: HTMLElement;
  readonly operationPolicy: OperationPolicy;
  readonly reportError: (message: string) => void;
}

export interface FeatureMountHandle {
  unmount(): Promise<void>;
}

export interface ApplicationFeatureRegistration<
  TPublic extends object = object,
> {
  readonly id: FeatureId;
  readonly navigation: {
    readonly label: string;
    readonly order: number;
  };
  readonly publicApi: TPublic;
  getAvailability(): Availability;
  subscribeAvailability(listener: (value: Availability) => void): () => void;
  mount(context: FeatureMountContext): Promise<FeatureMountHandle>;
}

export interface WorkerRegistrationContext {
  readonly addActionHandler: (
    id: FeatureId,
    handler: () => Promise<void>,
  ) => () => void;
  readonly reportError: (message: string) => void;
}

export type RegistrationError =
  | { readonly kind: "invalid_registration"; readonly detail: string }
  | { readonly kind: "duplicate_feature_id"; readonly id: FeatureId };

export interface ApplicationWorkerRegistration {
  readonly id: FeatureId;
  register(
    context: WorkerRegistrationContext,
  ): Result<() => void, RegistrationError>;
}

export interface FeatureRegistry {
  register<TPublic extends object>(
    feature: ApplicationFeatureRegistration<TPublic>,
  ): Result<void, RegistrationError>;
  snapshot(): readonly ApplicationFeatureRegistration[];
  subscribe(listener: () => void): () => void;
  dispose?(): void;
}

export type MaintenanceCursor = {
  readonly generation: number;
  readonly revision: number;
};

export type ShellMaintenanceState =
  | { readonly status: "inactive"; readonly cursor: MaintenanceCursor }
  | {
      readonly status: "active";
      readonly cursor: MaintenanceCursor;
      readonly message: string;
    };

export interface MaintenancePresentationPort {
  getSnapshot(): ShellMaintenanceState;
  subscribe(listener: (state: ShellMaintenanceState) => void): () => void;
}

export interface MaintenanceProjection extends MaintenancePresentationPort {
  accept(next: FoundationMaintenanceSnapshot): "applied" | "stale_ignored";
}

export interface MutationGate extends OperationPolicy {}

export type ShellViewState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly selected: FeatureId | null }
  | {
      readonly kind: "maintenance";
      readonly selected: FeatureId | null;
      readonly message: string;
    }
  | {
      readonly kind: "error";
      readonly message: string;
      readonly recoverable: boolean;
    };

export type StartupError = {
  readonly kind: "startup_failed";
  readonly message: string;
};

export type SelectionError = {
  readonly kind: "unavailable" | "mount_failed";
  readonly message: string;
};

export interface SidePanelHost {
  start(): Promise<Result<void, StartupError>>;
  select(id: FeatureId): Promise<Result<void, SelectionError>>;
  stop(): Promise<void>;
}

export type CompositionError = {
  readonly kind: "missing_dependency" | "startup_failed";
  readonly message: string;
};

export interface ApplicationCompositionRoot<TRootApi extends object> {
  start(): Promise<Result<{ readonly api: TRootApi }, CompositionError>>;
  stop(): Promise<void>;
}

export interface PublicApiEntry<
  TKey extends string = string,
  TPublic extends object = object,
> {
  readonly key: TKey;
  readonly publicApi: TPublic;
}

export type RootPublicContract<TEntries extends readonly PublicApiEntry[]> =
  Readonly<{
    [TEntry in TEntries[number] as TEntry["key"]]: TEntry["publicApi"];
  }>;

export type PublicApiCompositionError =
  | { readonly kind: "duplicate_public_api_key"; readonly key: string }
  | { readonly kind: "invalid_public_api"; readonly detail: string };

export interface PublicApiRegistry<TEntries extends Record<string, object>> {
  compose(entries: TEntries): Readonly<TEntries>;
  composeEntries<const TDynamicEntries extends readonly PublicApiEntry[]>(
    entries: TDynamicEntries,
  ): Result<RootPublicContract<TDynamicEntries>, PublicApiCompositionError>;
  composeUnknown(
    entries: unknown,
  ): Result<Readonly<Record<string, object>>, PublicApiCompositionError>;
}

export type { FoundationMaintenanceSnapshot, MaintenanceSnapshotSource };
