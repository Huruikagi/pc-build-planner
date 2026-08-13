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

export interface RequestRecord {
  readonly requestId: string;
  readonly digest: string;
  readonly revision: number;
}

export interface StoragePort<Root, Control> {
  readRoot(): Promise<CoreResult<unknown | undefined, StorageError>>;
  writeRoot(root: Root): Promise<CoreResult<void, StorageError>>;
  readControl(): Promise<CoreResult<unknown | undefined, StorageError>>;
  writeControl(control: Control): Promise<CoreResult<void, StorageError>>;
  bytesInUse(): Promise<CoreResult<number, StorageError>>;
  quotaBytes(): number;
  restrictToTrustedContexts(): Promise<CoreResult<void, StorageError>>;
}

export interface ExclusiveLockPort {
  runExclusive<T>(
    operation: () => Promise<T>,
  ): Promise<CoreResult<T, LockError>>;
}

export interface LocalDataPolicy<Root, Operation, Control, PolicyError> {
  decodeAndMigrate(input: unknown): CoreResult<Root, PolicyError>;
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

export interface ReplacementAssessmentTicket {
  readonly __opaqueReplacementTicket: unique symbol;
}

export interface FinalizationTicket {
  readonly __opaqueFinalizationTicket: unique symbol;
}

export type ReplacementMode = "normal" | "recovery";

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
