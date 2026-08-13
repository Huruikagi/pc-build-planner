import type { CapacityPolicy, CapacityStatus, CoreError, CoreResult, ErrorAdapter, ExclusiveLockPort, LocalDataPolicy, PersistentRecoveryProtocol, PolicyStage, ReplacementAssessment, ReplacementAssessmentTicket, ReplacementBinding, ReplacementCommitInput, ReplacementCommitResult, ReplacementMode, ReplacementReceipt, StoragePort } from "./contracts.js";

interface TicketBinding<Root, PersistentRecoveryControl, RecoveryFence> {
  readonly mode: ReplacementMode;
  readonly candidate: Root;
  readonly candidateDigest: string;
  readonly storedRevision: number;
  readonly rawFingerprint: string;
  readonly acquiredControl: PersistentRecoveryControl;
  readonly fence: RecoveryFence;
}
export interface ReplacementCoordinatorDependencies<Root, Operation, RootMaintenanceControl, PersistentRecoveryControl, Preview, PolicyError, OutputError, RecoveryFence = unknown, PendingCommit = unknown, CurrentAnomalyState = unknown, FinalizationCapability = unknown> {
  readonly storage: StoragePort<Root, PersistentRecoveryControl>;
  readonly lock: ExclusiveLockPort;
  readonly policy: LocalDataPolicy<Root, Operation, RootMaintenanceControl, PolicyError>;
  readonly errors: ErrorAdapter<PolicyError, OutputError>;
  readonly recovery: PersistentRecoveryProtocol<PersistentRecoveryControl, OutputError, RecoveryFence, PendingCommit, CurrentAnomalyState, FinalizationCapability>;
  readonly capacity: CapacityPolicy<Root>;
  readonly candidateDigest: (candidate: Root) => string;
  readonly rawFingerprint: (raw: unknown) => string;
  readonly newCapabilityId: () => string;
  readonly preview: (candidate: Root, capacity: CapacityStatus, mode: ReplacementMode) => Preview;
}

export interface ReplacementCoordinator<Root, Preview, Error = CoreError, FinalizationCapability = unknown> {
  assess(candidate: unknown): Promise<CoreResult<ReplacementAssessment<Preview>, Error>>;
  assessRecovery(candidate: unknown): Promise<CoreResult<ReplacementAssessment<Preview>, Error>>;
  commit(input: Readonly<ReplacementCommitInput<Root>>): Promise<CoreResult<ReplacementCommitResult<ReplacementReceipt<Root>, FinalizationCapability>, Error>>;
  findPendingFinalization(): Promise<CoreResult<FinalizationCapability | null, Error>>;
  finalize(ticket: FinalizationCapability): Promise<CoreResult<ReplacementReceipt<Root>, Error>>;
}

type PolicyFailure<E> = { readonly ok: false; readonly policyFailure: true; readonly error: E };
type ProtocolFailure<E> = { readonly ok: false; readonly protocolFailure: true; readonly error: E };
class ConsumerAdapterError { constructor(readonly cause: unknown) {} }
const failure = (code: CoreError["code"]): CoreResult<never, CoreError> => ({ ok: false, error: { code } });
const safeValue = <T>(operation: () => T, code: CoreError["code"]): CoreResult<T, CoreError> => {
  try { return { ok: true, value: operation() }; } catch { return failure(code); }
};

export const createReplacementCoordinator = <Root, Operation, RootMaintenanceControl, PersistentRecoveryControl, Preview, PolicyError = CoreError, OutputError = CoreError, RecoveryFence = unknown, PendingCommit = unknown, CurrentAnomalyState = unknown, FinalizationCapability = unknown>(
  dependencies: ReplacementCoordinatorDependencies<Root, Operation, RootMaintenanceControl, PersistentRecoveryControl, Preview, PolicyError, OutputError, RecoveryFence, PendingCommit, CurrentAnomalyState, FinalizationCapability>,
): ReplacementCoordinator<Root, Preview, OutputError, FinalizationCapability> => {
  type Internal<T> = CoreResult<T, CoreError | OutputError> | PolicyFailure<OutputError> | ProtocolFailure<OutputError>;
  const protocolResult = <T>(result: CoreResult<T, OutputError>): CoreResult<T, OutputError> | ProtocolFailure<OutputError> =>
    result.ok ? result : { ok: false, protocolFailure: true, error: result.error };
  const adaptPolicy = <T>(stage: PolicyStage, operation: () => CoreResult<T, PolicyError>): Internal<T> => {
    const result = operation();
    if (result.ok) return result;
    let adapted: CoreResult<OutputError, OutputError>;
    try { adapted = dependencies.errors.fromPolicy(stage, result.error); } catch (cause) { throw new ConsumerAdapterError(cause); }
    return { ok: false, policyFailure: true, error: adapted.ok ? adapted.value : adapted.error };
  };
  const decode = (input: unknown, fallback: PolicyStage): Internal<Root> => {
    const result = dependencies.policy.decodeAndMigrate(input);
    if (result.ok) return result;
    return adaptPolicy(fallback === "decode" ? dependencies.policy.decodeFailureStage?.(result.error) ?? "decode" : fallback, () => result);
  };
  const adaptResult = <T>(result: Internal<T>): CoreResult<T, OutputError> => {
    if (result.ok) return result;
    if ("policyFailure" in result || "protocolFailure" in result) return { ok: false, error: result.error };
    let adapted: CoreResult<OutputError, OutputError>;
    try { adapted = dependencies.errors.fromCore(result.error as CoreError); } catch (cause) { throw new ConsumerAdapterError(cause); }
    return { ok: false, error: adapted.ok ? adapted.value : adapted.error };
  };
  const publicResult = async <T>(operation: () => Promise<Internal<T>>): Promise<CoreResult<T, OutputError>> => {
    try { return adaptResult(await operation()); } catch (error) { if (error instanceof ConsumerAdapterError) throw error.cause; throw error; }
  };
  const bindings = new WeakMap<object, TicketBinding<Root, PersistentRecoveryControl, RecoveryFence>>();
  const readRoot = async () => dependencies.storage.readRoot().catch(() => failure("storage-unavailable"));
  const readControl = async () => dependencies.storage.readControl().catch(() => failure("storage-unavailable"));
  const writeControl = async (value: PersistentRecoveryControl) => dependencies.storage.writeControl(value).catch(() => failure("storage-unavailable"));
  const capacityFor = async (candidate: Root): Promise<CoreResult<CapacityStatus, CoreError>> => {
    const bytes = await dependencies.storage.bytesInUse().catch(() => failure("storage-unavailable"));
    if (!bytes.ok) return bytes;
    const quota = safeValue(dependencies.storage.quotaBytes, "storage-unavailable");
    if (!quota.ok) return quota;
    try { return dependencies.capacity.assess(bytes.value, candidate, quota.value); } catch { return failure("quota-exceeded"); }
  };

  const assessMode = async (candidateInput: unknown, mode: ReplacementMode): Promise<Internal<ReplacementAssessment<Preview>>> => {
    const raw = await readRoot(); if (!raw.ok) return raw;
    const fingerprint = safeValue(() => dependencies.rawFingerprint(raw.value), "validation"); if (!fingerprint.ok) return fingerprint;
    const currentState = protocolResult(dependencies.recovery.observeCurrent(raw.value)); if (!currentState.ok) return currentState;
    const current = decode(raw.value, "decode");
    let revision = 0;
    if (mode === "normal") {
      if (!current.ok) return current;
      const found = safeValue(() => dependencies.policy.revision(current.value), "validation");
      if (!found.ok || !Number.isSafeInteger(found.value) || found.value < 0) return failure("validation");
      revision = found.value;
    } else if (current.ok) return failure("stale-recovery-state");
    const control = await readControl(); if (!control.ok) return control;
    const acquired = protocolResult(dependencies.recovery.acquire(control.value, mode, currentState.value)); if (!acquired.ok) return acquired;
    const decoded = decode(candidateInput, "decode"); if (!decoded.ok) return decoded;
    const repaired = adaptPolicy("repair", () => dependencies.policy.repair(decoded.value, current.ok ? current.value : decoded.value)); if (!repaired.ok) return repaired;
    const validated = adaptPolicy("validation", () => dependencies.policy.decodeAndMigrate(repaired.value)); if (!validated.ok) return validated;
    const capacity = await capacityFor(validated.value); if (!capacity.ok) return capacity;
    const digest = safeValue(() => dependencies.candidateDigest(validated.value), "validation"); if (!digest.ok) return digest;
    const preview = safeValue(() => dependencies.preview(validated.value, capacity.value, mode), "validation"); if (!preview.ok) return preview;
    const ticket = Object.freeze({}) as ReplacementAssessmentTicket;
    bindings.set(ticket, { mode, candidate: validated.value, candidateDigest: digest.value, storedRevision: revision, rawFingerprint: fingerprint.value, acquiredControl: acquired.value.control, fence: acquired.value.fence });
    return { ok: true, value: { preview: preview.value, ticket } };
  };

  const coordinator = {
    assess: (candidate: unknown) => assessMode(candidate, "normal"),
    assessRecovery: (candidate: unknown) => assessMode(candidate, "recovery"),
    async commit(input: Readonly<ReplacementCommitInput<Root>>): Promise<Internal<ReplacementCommitResult<ReplacementReceipt<Root>, FinalizationCapability>>> {
      const binding = bindings.get(input.ticket as object);
      if (!binding || binding.mode !== input.mode) return failure("stale-assessment");
      let acquiredControl = binding.acquiredControl;
      let acquiredFence = binding.fence;
      const stale = () => { bindings.delete(input.ticket as object); return failure("stale-assessment"); };
      try {
        const locked = await dependencies.lock.runExclusive(async (): Promise<Internal<ReplacementCommitResult<ReplacementReceipt<Root>, FinalizationCapability>>> => {
          let control = await readControl(); if (!control.ok) return control;
          const raw = await readRoot(); if (!raw.ok) return raw;
          const fingerprint = safeValue(() => dependencies.rawFingerprint(raw.value), "validation"); if (!fingerprint.ok) return fingerprint;
          const currentState = protocolResult(dependencies.recovery.observeCurrent(raw.value)); if (!currentState.ok) return currentState;
          let classified = protocolResult(dependencies.recovery.classifyCurrent(control.value, currentState.value)); if (!classified.ok) return classified;
          if (classified.value.kind === "postcommit-finalization") return failure("recovery-active");
          if (classified.value.kind === "precommit-pending") {
            const cleaned = protocolResult(dependencies.recovery.release(control.value, classified.value.pending));
            if (!cleaned.ok) return cleaned;
            const cleanupWrite = await writeControl(cleaned.value); if (!cleanupWrite.ok) return cleanupWrite;
            control = { ok: true, value: cleaned.value };
            classified = protocolResult(dependencies.recovery.classifyCurrent(control.value, currentState.value)); if (!classified.ok) return classified;
            if (classified.value.kind !== "clear") return failure("recovery-active");
            const reacquired = protocolResult(dependencies.recovery.acquire(control.value, input.mode, currentState.value)); if (!reacquired.ok) return reacquired;
            bindings.set(input.ticket as object, { ...binding, acquiredControl: reacquired.value.control, fence: reacquired.value.fence });
            acquiredControl = reacquired.value.control;
            acquiredFence = reacquired.value.fence;
          }
          const current = adaptPolicy("assessment", () => dependencies.policy.decodeAndMigrate(raw.value));
          let revision = 0;
          if (input.mode === "normal") {
            if (!current.ok) return "policyFailure" in current ? current : stale();
            const found = safeValue(() => dependencies.policy.revision(current.value), "validation"); if (!found.ok) return stale();
            revision = found.value;
          } else if (current.ok) return failure("stale-recovery-state");
          if (fingerprint.value !== binding.rawFingerprint || revision !== binding.storedRevision) return stale();
          const candidate = decode(input.candidate, "decode"); if (!candidate.ok) return candidate;
          const repaired = adaptPolicy("repair", () => dependencies.policy.repair(candidate.value, current.ok ? current.value : candidate.value)); if (!repaired.ok) return repaired;
          const digest = safeValue(() => dependencies.candidateDigest(repaired.value), "validation"); if (!digest.ok || digest.value !== binding.candidateDigest) return stale();
          if (revision >= Number.MAX_SAFE_INTEGER) return failure("validation");
          const nextRevision = input.mode === "normal" ? revision + 1 : Math.max(1, dependencies.policy.revision(repaired.value));
          const committedRoot = dependencies.policy.withRevision(repaired.value, nextRevision);
          const validated = adaptPolicy("replacement-validation", () => dependencies.policy.decodeAndMigrate(committedRoot)); if (!validated.ok) return validated;
          const capacity = await capacityFor(validated.value); if (!capacity.ok) return capacity;
          const currentIdentity = safeValue(() => dependencies.rawFingerprint(raw.value), "validation"); if (!currentIdentity.ok) return currentIdentity;
          const replacementBinding: ReplacementBinding = { mode: input.mode, candidateIdentity: digest.value, currentIdentity: currentIdentity.value, targetRevision: nextRevision };
          const prepared = protocolResult(dependencies.recovery.prepareCommit(acquiredControl, acquiredFence, replacementBinding)); if (!prepared.ok) return prepared;
          const saved = await writeControl(prepared.value.control); if (!saved.ok) return saved;
          const written = await dependencies.storage.writeRoot(validated.value).catch(() => failure("storage-unavailable")); if (!written.ok) return written;
          bindings.delete(input.ticket as object);
          const released = protocolResult(dependencies.recovery.release(prepared.value.control, prepared.value.pending));
          const releaseWrite = released.ok ? await writeControl(released.value) : released;
          const receipt = { root: validated.value, revision: nextRevision, capacity: capacity.value };
          if (!releaseWrite.ok) {
            return { ok: true, value: { kind: "committed-finalization-required", receipt, finalization: prepared.value.finalization } };
          }
          return { ok: true, value: { kind: "committed", receipt } };
        });
        return locked.ok ? locked.value : locked;
      } catch (error) { if (error instanceof ConsumerAdapterError) throw error.cause; return failure("lock-unavailable"); }
    },
    async findPendingFinalization(): Promise<Internal<FinalizationCapability | null>> {
      const control = await readControl(); if (!control.ok) return control;
      const raw = await readRoot(); if (!raw.ok) return raw;
      const current = protocolResult(dependencies.recovery.observeCurrent(raw.value)); if (!current.ok) return current;
      const classified = protocolResult(dependencies.recovery.classifyCurrent(control.value, current.value)); if (!classified.ok) return classified;
      return { ok: true, value: classified.value.kind === "postcommit-finalization" ? classified.value.ticket : null };
    },
    async finalize(ticket: FinalizationCapability): Promise<Internal<ReplacementReceipt<Root>>> {
      try {
        const locked = await dependencies.lock.runExclusive(async (): Promise<Internal<ReplacementReceipt<Root>>> => {
          const control = await readControl();
          if (!control.ok) return control;
          const raw = await readRoot(); if (!raw.ok) return raw;
          const currentState = protocolResult(dependencies.recovery.observeCurrent(raw.value)); if (!currentState.ok) return currentState;
          const classified = protocolResult(dependencies.recovery.classifyCurrent(control.value, currentState.value)); if (!classified.ok) return classified;
          if (classified.value.kind !== "postcommit-finalization") return failure("stale-assessment");
          const finalized = protocolResult(dependencies.recovery.finalize(control.value, ticket, currentState.value));
          if (!finalized.ok) return finalized;
          const written = await writeControl(finalized.value);
          if (!written.ok) return written;
          const decoded = decode(raw.value, "decode"); if (!decoded.ok) return decoded;
          const revision = safeValue(() => dependencies.policy.revision(decoded.value), "validation"); if (!revision.ok) return revision;
          const capacity = await capacityFor(decoded.value); if (!capacity.ok) return capacity;
          return { ok: true, value: { root: decoded.value, revision: revision.value, capacity: capacity.value } };
        });
        return locked.ok ? locked.value : locked;
      } catch { return failure("lock-unavailable"); }
    },
  };
  return {
    assess: (candidate) => publicResult(() => coordinator.assess(candidate)),
    assessRecovery: (candidate) => publicResult(() => coordinator.assessRecovery(candidate)),
    commit: (input) => publicResult(() => coordinator.commit(input)),
    findPendingFinalization: () => publicResult(() => coordinator.findPendingFinalization()),
    finalize: (ticket) => publicResult(() => coordinator.finalize(ticket)),
  };
};
