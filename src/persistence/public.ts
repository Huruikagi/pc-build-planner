/** 復元commitのfence受け渡しにだけ必要な最小型。owner/lease操作capabilityそのものは公開しない。 */
export type { MaintenanceFence } from "./maintenance.js";
export type {
  MaintenanceSnapshot,
  MaintenanceSnapshotSource,
} from "./maintenance-snapshot-source.js";
export { createMaintenanceSnapshotSource } from "./maintenance-snapshot-source.js";
export type {
  MutationCapacityStatus,
  RootOperation,
} from "./mutation-pipeline.js";
export { initializeProductionFoundationRuntimeContribution } from "./production-runtime-contribution.js";
export type { ReplacementAssessment } from "./replacement.js";
export type {
  MaintenanceCommand,
  MaintenanceReceipt,
  ReplacementCommand,
  ReplacementReceipt,
  RequestCommitReceipt,
} from "./root-transaction-runner.js";
export type {
  FoundationRuntimeContribution,
  FoundationRuntimeInitializationError,
  FoundationRuntimePlatform,
} from "./runtime-contribution.js";
export { initializeFoundationRuntimeContributionFromPlatform as initializeFoundationRuntimeContribution } from "./runtime-contribution.js";
export type {
  CallerClassification,
  DataWorkerRegistration,
  DataWorkerRegistrationDependencies,
  FoundationCommand,
  FoundationCommandDecoder,
  FoundationCommandReceipt,
  RegistrationDisposer,
  RegistrationError,
  WireRootMutationCommand,
  WireRootOperation,
  WorkerMessageHandler,
  WorkerMessageTarget,
} from "./worker-registration.js";
export {
  createDataWorkerRegistration,
  createFoundationCommandRouter,
  decodeFoundationCommand,
  foundationCommandDecoder,
} from "./worker-registration.js";
export type {
  FoundationDataPort,
  FoundationScopedDataPort,
  MutationReceipt,
  MutationValue,
  RootMutationCommand,
} from "./write-authority.js";
