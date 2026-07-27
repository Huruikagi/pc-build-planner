export type { ActivationRouterOptions } from "./activation-router.js";
export { createActivationRouter } from "./activation-router.js";
export type {
  CompositionFeature,
  CompositionRootApi,
  CompositionRootOptions,
  FoundationCompositionHandle,
} from "./composition-root.js";
export { createCompositionRoot } from "./composition-root.js";
export type {
  ActivationRouter,
  ApplicationCompositionRoot,
  ApplicationFeatureRegistration,
  ApplicationWorkerRegistration,
  Availability,
  CompositionError,
  FeatureActivationAdapter,
  FeatureActivationError,
  FeatureActivationIntent,
  FeatureId,
  FeatureMountContext,
  FeatureMountHandle,
  OperationKind,
  OperationPolicy,
  PersistentApplicationFeatureRegistration,
  PreparedFeatureActivation,
  RegistrationError,
  ShellNavigationMetadata,
  ShellNavigator,
  TransientApplicationFeatureRegistration,
  WorkerRegistrationContext,
} from "./contracts.js";
export { isPersistent } from "./contracts.js";
export type {
  FeatureCompositionContext,
  FeatureContribution,
  FeatureContributionFactory,
} from "./feature-contribution-catalog.js";
export type {
  SidePanelBootstrap,
  SidePanelBootstrapError,
  SidePanelBootstrapOptions,
  SidePanelBootstrapResult,
} from "./runtime-bootstrap.js";
export { createSidePanelBootstrap } from "./runtime-bootstrap.js";
export type {
  ActivationId,
  TargetTabId,
  TargetTabIdValidationError,
  TransientActivationRequest,
  TransientDismissReason,
  TransientGestureRegistrationError,
  TransientGestureRegistrationPort,
  TransientGestureSource,
  TransientSurfaceError,
  TransientSurfaceLifecyclePort,
} from "./transient-surface-ports.js";
export { parseTargetTabId } from "./transient-surface-ports.js";
