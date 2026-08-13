export type CoreResult<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export type StorageErrorCode =
  | "access-denied"
  | "quota-exceeded"
  | "storage-unavailable";

export interface StorageError {
  readonly code: StorageErrorCode;
}

export interface LockError {
  readonly code: "lock-unavailable";
}

export interface CapacityError {
  readonly code: "quota-exceeded";
}

export type CoreErrorCode =
  | "validation"
  | "migration"
  | "repair"
  | "revision-conflict"
  | "request-conflict"
  | "maintenance-active"
  | "recovery-active"
  | "stale-fence"
  | "stale-assessment"
  | "stale-recovery-state"
  | "precommit-cleanup-pending"
  | "quota-exceeded"
  | "access-denied"
  | "lock-unavailable"
  | "storage-unavailable";

export interface CoreError {
  readonly code: CoreErrorCode;
}

export type PolicyStage =
  | "decode"
  | "migration"
  | "mutation"
  | "repair"
  | "validation"
  | "assessment"
  | "replacement-validation";

export interface ErrorAdapter<PolicyError, OutputError> {
  fromPolicy(
    stage: PolicyStage,
    error: PolicyError,
  ): CoreResult<OutputError, OutputError>;
  fromCore(error: CoreError): CoreResult<OutputError, OutputError>;
}

export interface RequestRecord {
  readonly requestId: string;
  readonly digest: string;
  readonly revision: number;
}

export interface StoragePort<Root, PersistentRecoveryControl> {
  readRoot(): Promise<CoreResult<unknown | undefined, StorageError>>;
  writeRoot(root: Root): Promise<CoreResult<void, StorageError>>;
  readControl(): Promise<CoreResult<unknown | undefined, StorageError>>;
  writeControl(control: PersistentRecoveryControl): Promise<CoreResult<void, StorageError>>;
  bytesInUse(): Promise<CoreResult<number, StorageError>>;
  quotaBytes(): number;
  restrictToTrustedContexts(): Promise<CoreResult<void, StorageError>>;
}

export interface ExclusiveLockPort {
  runExclusive<T>(
    operation: () => Promise<T>,
  ): Promise<CoreResult<T, LockError>>;
}

export interface PersistentControlPolicy<PersistentRecoveryControl, OutputError = CoreError> {
  authorizeMutation(
    control: PersistentRecoveryControl | undefined,
    now: number,
  ): CoreResult<void, OutputError>;
}

export interface LocalDataPolicy<Root, Operation, Control, PolicyError> {
  decodeAndMigrate(input: unknown): CoreResult<Root, PolicyError>;
  decodeFailureStage?(error: PolicyError): "decode" | "migration";
  apply(root: Root, operation: Operation): CoreResult<Root, PolicyError>;
  repair(root: Root, previous: Root): CoreResult<Root, PolicyError>;
  revision(root: Root): number;
  withRevision(root: Root, revision: number): Root;
  requestRecord(root: Root, requestId: string): RequestRecord | undefined;
  withRequestRecord(root: Root, record: RequestRecord): Root;
  control(root: Root): Control;
  withControl(root: Root, control: Control): Root;
}

export interface TransactionCommand<Operation> {
  readonly requestId: string;
  readonly expectedRevision: number;
  readonly operation: Operation;
}

export interface CapacityStatus {
  readonly beforeBytes: number;
  readonly afterBytes: number;
  readonly warningThresholdBytes: number;
  readonly quotaBytes: number;
  readonly warning: boolean;
}

export interface CapacityPolicy<Root> {
  assess(
    currentBytes: number,
    candidate: Root,
    quotaBytes: number,
  ): CoreResult<CapacityStatus, CapacityError>;
}

export interface TransactionReceipt<Value> {
  readonly revision: number;
  readonly value: Value;
  readonly capacity: CapacityStatus;
  readonly deduplicated: boolean;
}

export interface TransactionPort<Operation, Value, Error> {
  execute(
    command: TransactionCommand<Operation>,
  ): Promise<CoreResult<TransactionReceipt<Value>, Error>>;
}

declare const replacementAssessmentTicketBrand: unique symbol;
export interface ReplacementAssessmentTicket {
  readonly [replacementAssessmentTicketBrand]: "replacement-assessment";
}

export interface ReplacementAssessment<Preview> {
  readonly preview: Preview;
  readonly ticket: ReplacementAssessmentTicket;
}

export interface FinalizationTicket {
  readonly __opaqueFinalizationTicket: unique symbol;
}

export interface ReplacementReceipt<Root> {
  readonly root: Root;
  readonly revision: number;
  readonly capacity: CapacityStatus;
}

export type ReplacementMode = "normal" | "recovery";

export interface ReplacementBinding {
  readonly mode: ReplacementMode;
  readonly candidateIdentity: string;
  readonly currentIdentity: string;
  readonly targetRevision: number;
}

export type RecoveryCommitState<PendingCommit> =
  | { readonly kind: "clear" }
  | { readonly kind: "precommit-pending"; readonly pending: PendingCommit }
  | {
      readonly kind: "postcommit-finalization";
      readonly pending: PendingCommit;
      readonly ticket: FinalizationTicket;
    };

export interface PersistentRecoveryProtocol<
  PersistentRecoveryControl,
  ProtocolError,
  RecoveryFence = unknown,
  PendingCommit = unknown,
  CurrentAnomalyState = unknown,
> {
  authorizeMutation(control: unknown): CoreResult<void, ProtocolError>;
  observeCurrent(rawRoot: unknown): CoreResult<CurrentAnomalyState, ProtocolError>;
  acquire(
    control: unknown,
    mode: ReplacementMode,
    current: CurrentAnomalyState,
  ): CoreResult<Readonly<{ control: PersistentRecoveryControl; fence: RecoveryFence }>, ProtocolError>;
  prepareCommit(
    control: unknown,
    fence: RecoveryFence,
    binding: ReplacementBinding,
  ): CoreResult<Readonly<{ control: PersistentRecoveryControl; pending: PendingCommit }>, ProtocolError>;
  classifyCurrent(
    control: unknown,
    current: CurrentAnomalyState,
  ): CoreResult<RecoveryCommitState<PendingCommit>, ProtocolError>;
  release(
    control: unknown,
    capability: RecoveryFence | PendingCommit,
  ): CoreResult<PersistentRecoveryControl, ProtocolError>;
  finalize(
    control: unknown,
    ticket: FinalizationTicket,
    current: CurrentAnomalyState,
  ): CoreResult<PersistentRecoveryControl, ProtocolError>;
}

export interface ReplacementCommitInput<Root> {
  readonly candidate: Root;
  readonly mode: ReplacementMode;
  readonly ticket: ReplacementAssessmentTicket;
}

export type ReplacementCommitResult<Receipt> =
  | { readonly kind: "committed"; readonly receipt: Receipt }
  | {
      readonly kind: "committed-finalization-required";
      readonly receipt: Receipt;
      readonly finalization: FinalizationTicket;
    };

export interface RootReplacementPort<Root, Assessment, Receipt, Error> {
  assess(candidate: unknown): Promise<CoreResult<Assessment, Error>>;
  assessRecovery(candidate: unknown): Promise<CoreResult<Assessment, Error>>;
  commit(
    input: Readonly<ReplacementCommitInput<Root>>,
  ): Promise<CoreResult<ReplacementCommitResult<Receipt>, Error>>;
  findPendingFinalization(): Promise<
    CoreResult<FinalizationTicket | null, Error>
  >;
  finalize(ticket: FinalizationTicket): Promise<CoreResult<Receipt, Error>>;
}
