import {
  createReplacementCoordinator,
  createTransactionEngine,
  type ErrorAdapter,
  type PersistentRecoveryProtocol,
  type ReplacementAssessment,
  type ReplacementCoordinator,
  type ReplacementCoordinatorDependencies,
  type ReplacementReceipt,
  type RootReplacementPort,
  type TransactionEngineDependencies,
  type TransactionPort,
} from "@pc-build-planner/local-data";
import {
  createBackupOrchestrator,
  type BackupOrchestrator,
  type BackupOrchestratorDependencies,
} from "@pc-build-planner/local-data/backup";

interface ConsumerRoot {
  readonly revision: number;
  readonly value: string;
}
interface ConsumerOperation {
  readonly replacement: string;
}
interface RootMaintenanceControl {
  readonly maintenanceOwner: "root-owner";
}
interface PersistentRecoveryControl {
  readonly recoveryOwner: "recovery-owner";
}
interface PolicyError {
  readonly policyCode: "invalid-root";
}
interface OutputError {
  readonly outputCode: "consumer-error";
}
interface RecoveryFence {
  readonly recoveryFence: unique symbol;
}
interface PendingCommit {
  readonly pendingCommit: unique symbol;
}
interface CurrentAnomalyState {
  readonly anomalyState: unique symbol;
}
interface FinalizationCapability {
  readonly finalizationCapability: unique symbol;
}
interface Preview {
  readonly value: string;
}
interface RestoreInput {
  readonly source: string;
}
interface Artifact {
  readonly payload: string;
}

declare const errors: ErrorAdapter<PolicyError, OutputError>;
declare const transactionDependencies: TransactionEngineDependencies<
  ConsumerRoot,
  ConsumerOperation,
  RootMaintenanceControl,
  PersistentRecoveryControl,
  PolicyError,
  OutputError
>;
declare const recovery: PersistentRecoveryProtocol<
  PersistentRecoveryControl,
  OutputError,
  RecoveryFence,
  PendingCommit,
  CurrentAnomalyState,
  FinalizationCapability
>;
declare const replacementDependencies: ReplacementCoordinatorDependencies<
  ConsumerRoot,
  ConsumerOperation,
  RootMaintenanceControl,
  PersistentRecoveryControl,
  Preview,
  PolicyError,
  OutputError,
  RecoveryFence,
  PendingCommit,
  CurrentAnomalyState,
  FinalizationCapability
>;

const transaction: TransactionPort<ConsumerOperation, ConsumerRoot, OutputError> =
  createTransactionEngine(transactionDependencies);
const replacement: ReplacementCoordinator<
  ConsumerRoot,
  Preview,
  OutputError,
  FinalizationCapability
> = createReplacementCoordinator(replacementDependencies);
const replacementPort: RootReplacementPort<
  ConsumerRoot,
  ReplacementAssessment<Preview>,
  ReplacementReceipt<ConsumerRoot>,
  OutputError,
  FinalizationCapability
> = replacement;

declare const backupDependencies: BackupOrchestratorDependencies<
  ConsumerRoot,
  RestoreInput,
  RestoreInput,
  RestoreInput,
  RestoreInput,
  string,
  Artifact,
  Preview,
  Preview,
  ReplacementReceipt<ConsumerRoot>,
  OutputError,
  FinalizationCapability
>;
const backup: BackupOrchestrator<
  RestoreInput,
  Artifact,
  Preview,
  ReplacementReceipt<ConsumerRoot>,
  OutputError,
  FinalizationCapability
> = createBackupOrchestrator(backupDependencies);

void errors;
void recovery;
void transaction;
void replacementPort;
void backup;
