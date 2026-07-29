import type { Result } from "../domain/public.js";
import type {
  MaintenanceSnapshot as FoundationMaintenanceSnapshot,
  MaintenanceSnapshotSource,
} from "../persistence/public.js";
import type { MessageDescriptor, MessageKey } from "../ui-messages/public.js";
import type { TransientActivationRequest } from "./transient-surface-ports.js";

export type FeatureId = string & { readonly __brand: "FeatureId" };

export type OperationKind = "read" | "mutation";

export type Availability =
  | { readonly status: "available" }
  | { readonly status: "unavailable"; readonly reason: string };

export interface OperationPolicy {
  isAllowed(kind: OperationKind): boolean;
  /**
   * Notifies when the allowed operation set changes. Features are not remounted
   * on a maintenance transition, so this is their only way to observe one.
   */
  subscribe(listener: () => void): () => void;
}

export interface FeatureMountContext {
  readonly container: HTMLElement;
  readonly operationPolicy: OperationPolicy;
  readonly reportError: (message: string) => void;
  /** Opaque state captured from this same feature during activation rollback. */
  readonly restoredState?: unknown;
}

export interface FeatureMountHandle {
  unmount(): Promise<void>;
  /** Captures opaque feature-owned state before a cross-feature activation. */
  captureState?(): Promise<Result<unknown, FeatureActivationError>>;
}

/** A feature-neutral request whose payload remains untrusted at the shell boundary. */
export interface FeatureActivationIntent {
  readonly featureId: FeatureId;
  readonly target: string;
  readonly payload: unknown;
}

export type FeatureActivationFailureReason =
  | "operation-blocked"
  | "target-data-unavailable"
  | "target-state-unavailable";

export type FeatureActivationError =
  | { readonly kind: "feature_not_found"; readonly featureId: FeatureId }
  | { readonly kind: "feature_unavailable"; readonly featureId: FeatureId }
  | { readonly kind: "invalid_activation"; readonly detail: string }
  | { readonly kind: "mount_failed"; readonly featureId: FeatureId }
  | {
      readonly kind: "activation_failed";
      readonly detail: string;
      readonly reason?: FeatureActivationFailureReason;
    };

export interface FeatureActivationAdapter<TActivation> {
  validate(
    intent: FeatureActivationIntent,
  ): Result<TActivation, FeatureActivationError>;
  activate(input: TActivation): Promise<Result<void, FeatureActivationError>>;
}

export interface FeatureRegistrationBase<
  TPublic extends object = object,
  TActivation = never,
> {
  readonly id: FeatureId;
  readonly publicApi: TPublic;
  getAvailability(): Availability;
  subscribeAvailability(listener: (value: Availability) => void): () => void;
  mount(context: FeatureMountContext): Promise<FeatureMountHandle>;
  readonly activation?: FeatureActivationAdapter<TActivation>;
}

export interface ShellNavigationMetadata {
  readonly labelKey: MessageKey;
  readonly order: number;
  /** Semantic icon key rendered by the shell navigation (falls back to label). */
  readonly icon?: string;
}

export interface PersistentApplicationFeatureRegistration<
  TPublic extends object = object,
  TActivation = never,
> extends FeatureRegistrationBase<TPublic, TActivation> {
  readonly presentation: "persistent";
  readonly navigation: ShellNavigationMetadata;
}

export interface TransientApplicationFeatureRegistration<
  TPublic extends object = object,
  TTransientActivation = TransientActivationRequest,
  THandoffActivation = never,
> extends FeatureRegistrationBase<TPublic, THandoffActivation> {
  readonly presentation: "transient";
  readonly navigation?: never;
  readonly transientActivation: TransientActivationAdapter<TTransientActivation>;
}

export interface TransientActivationLease {
  release(): Promise<void>;
}

export interface TransientActivationAdapter<TTransientActivation> {
  validate(
    request: TransientActivationRequest,
  ): Result<TTransientActivation, FeatureActivationError>;
  accept(
    input: TTransientActivation,
  ): Promise<Result<TransientActivationLease, FeatureActivationError>>;
}

export type ApplicationFeatureRegistration<
  TPublic extends object = object,
  THandoffActivation = never,
  TTransientActivation = TransientActivationRequest,
> =
  | PersistentApplicationFeatureRegistration<TPublic, THandoffActivation>
  | TransientApplicationFeatureRegistration<
      TPublic,
      TTransientActivation,
      THandoffActivation
    >;

export const isPersistent = <
  TPublic extends object,
  THandoffActivation,
  TTransientActivation,
>(
  registration: ApplicationFeatureRegistration<
    TPublic,
    THandoffActivation,
    TTransientActivation
  >,
): registration is PersistentApplicationFeatureRegistration<
  TPublic,
  THandoffActivation
> => registration.presentation === "persistent";

export interface PreparedFeatureActivation {
  readonly feature: ApplicationFeatureRegistration;
  activate(): Promise<Result<void, FeatureActivationError>>;
}

export interface ActivationRouter {
  prepare(
    intent: FeatureActivationIntent,
  ): Result<PreparedFeatureActivation, FeatureActivationError>;
}

export interface ShellNavigator {
  activate(
    intent: FeatureActivationIntent,
  ): Promise<Result<void, FeatureActivationError>>;
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
  register<TPublic extends object, TActivation>(
    feature: ApplicationFeatureRegistration<TPublic, TActivation>,
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
      readonly message: MessageDescriptor;
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
  | {
      readonly kind: "ready";
      readonly selected: FeatureId | null;
      readonly transientNotice?: TransientNotice;
    }
  | {
      readonly kind: "maintenance";
      readonly selected: FeatureId | null;
      readonly message: MessageDescriptor;
      readonly transientNotice?: TransientNotice;
    }
  | {
      readonly kind: "error";
      readonly message: MessageDescriptor;
      readonly recoverable: boolean;
    };

export interface TransientNotice {
  readonly message: MessageDescriptor;
  readonly recoverable: true;
}

export type StartupError = {
  readonly kind: "startup_failed";
  readonly message: MessageDescriptor;
};

export type SelectionError = {
  readonly kind: "unavailable" | "mount_failed";
  readonly message: MessageDescriptor;
};

export interface SidePanelHost {
  start(): Promise<Result<void, StartupError>>;
  select(id: FeatureId): Promise<Result<void, SelectionError>>;
  activate(
    intent: FeatureActivationIntent,
  ): Promise<Result<void, FeatureActivationError>>;
  getSelected(): FeatureId | null;
  showTransient(
    request: TransientActivationRequest,
  ): Promise<Result<void, SelectionError>>;
  restorePersistent(
    preferred: FeatureId | null,
    reason: "navigated" | "tab-closed" | "persistent-selected",
  ): Promise<Result<void, SelectionError>>;
  stop(): Promise<void>;
}

export type CompositionError = {
  readonly kind: "missing_dependency" | "startup_failed";
  readonly message: MessageDescriptor;
};

export interface ApplicationCompositionRoot<TRootApi extends object> {
  start(): Promise<Result<{ readonly api: TRootApi }, CompositionError>>;
  activate?(
    intent: FeatureActivationIntent,
  ): Promise<Result<void, FeatureActivationError>>;
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
