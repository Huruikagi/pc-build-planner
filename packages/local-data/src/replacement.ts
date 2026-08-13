import type { CapacityPolicy, CapacityStatus, CoreError, CoreResult, ExclusiveLockPort, FinalizationTicket, LocalDataPolicy, ReplacementAssessment, ReplacementAssessmentTicket, ReplacementCommitInput, ReplacementCommitResult, ReplacementMode, ReplacementReceipt, StoragePort } from "./contracts.js";

interface TicketBinding { readonly id: string; readonly mode: ReplacementMode; readonly candidateDigest: string; readonly storedRevision: number; readonly rawFingerprint: string; readonly owner: string; readonly generation: number }
interface PendingCommit { readonly ticketId: string; readonly finalizationId: string; readonly mode: ReplacementMode; readonly candidateDigest: string; readonly revision: number; readonly owner: string; readonly generation: number }

export interface ReplacementCoordinatorDependencies<Root, Operation, Control, Preview> {
  readonly storage: StoragePort<Root, Control>;
  readonly lock: ExclusiveLockPort;
  readonly policy: LocalDataPolicy<Root, Operation, Control, CoreError>;
  readonly capacity: CapacityPolicy<Root>;
  readonly candidateDigest: (candidate: Root) => string;
  readonly rawFingerprint: (raw: unknown) => string;
  /** Must return a collision-resistant, non-secret runtime capability id. */
  readonly newCapabilityId: () => string;
  readonly preview: (candidate: Root, capacity: CapacityStatus, mode: ReplacementMode) => Preview;
}

export interface ReplacementCoordinator<Root, Preview> {
  assess(candidate: unknown): Promise<CoreResult<ReplacementAssessment<Preview>, CoreError>>;
  assessRecovery(candidate: unknown): Promise<CoreResult<ReplacementAssessment<Preview>, CoreError>>;
  commit(input: Readonly<ReplacementCommitInput<Root>>): Promise<CoreResult<ReplacementCommitResult<ReplacementReceipt<Root>>, CoreError>>;
  findPendingFinalization(): Promise<CoreResult<FinalizationTicket | null, CoreError>>;
  finalize(ticket: FinalizationTicket): Promise<CoreResult<ReplacementReceipt<Root>, CoreError>>;
}

const failure = (code: CoreError["code"]): CoreResult<never, CoreError> => ({ ok: false, error: { code } });
const safely = <T>(operation: () => CoreResult<T, CoreError>, code: CoreError["code"]): CoreResult<T, CoreError> => {
  try { return operation(); } catch { return failure(code); }
};
const safeValue = <T>(operation: () => T, code: CoreError["code"]): CoreResult<T, CoreError> => {
  try { return { ok: true, value: operation() }; } catch { return failure(code); }
};
const activeFence = (value: unknown, mode: ReplacementMode): { readonly owner: string; readonly generation: number } | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const input = value as Record<string, unknown>;
  if (input.active !== true || input.kind !== (mode === "normal" ? "maintenance" : "recovery") || typeof input.owner !== "string" || input.owner.length === 0 || !Number.isSafeInteger(input.generation) || (input.generation as number) <= 0) return undefined;
  return { owner: input.owner, generation: input.generation as number };
};

export const createReplacementCoordinator = <Root, Operation, Control, Preview>(dependencies: ReplacementCoordinatorDependencies<Root, Operation, Control, Preview>): ReplacementCoordinator<Root, Preview> => {
  const bindings = new WeakMap<object, TicketBinding>();
  const finalizations = new WeakMap<object, PendingCommit>();
  const capabilityIds = new Set<string>();
  const identifier = (): CoreResult<string, CoreError> => {
    const value = safeValue(dependencies.newCapabilityId, "validation");
    if (!value.ok || value.value.length === 0 || capabilityIds.has(value.value))
      return failure("validation");
    capabilityIds.add(value.value);
    return value;
  };

  const pendingFrom = (value: unknown): PendingCommit | undefined => {
    if (typeof value !== "object" || value === null) return undefined;
    const pending = (value as Record<string, unknown>).__replacementPending;
    if (typeof pending !== "object" || pending === null) return undefined;
    const p = pending as Record<string, unknown>;
    if (typeof p.ticketId !== "string" || typeof p.finalizationId !== "string" || (p.mode !== "normal" && p.mode !== "recovery") || typeof p.candidateDigest !== "string" || !Number.isSafeInteger(p.revision) || typeof p.owner !== "string" || !Number.isSafeInteger(p.generation)) return undefined;
    return p as unknown as PendingCommit;
  };
  const withPending = (value: unknown, pending: PendingCommit | undefined): Control => {
    const base = typeof value === "object" && value !== null ? { ...(value as Record<string, unknown>) } : {};
    if (pending === undefined) delete base.__replacementPending;
    else base.__replacementPending = pending;
    return base as Control;
  };
  const readControl = async (): Promise<CoreResult<unknown | undefined, CoreError>> => {
    try { return await dependencies.storage.readControl(); } catch { return failure("storage-unavailable"); }
  };
  const writeControl = async (value: Control): Promise<CoreResult<void, CoreError>> => {
    try { return await dependencies.storage.writeControl(value); } catch { return failure("storage-unavailable"); }
  };

  const evaluate = async (candidateInput: unknown, mode: ReplacementMode): Promise<CoreResult<{ readonly candidate: Root; readonly preview: Preview; readonly binding: TicketBinding }, CoreError>> => {
    let rawRead: CoreResult<unknown | undefined, CoreError>;
    try { rawRead = await dependencies.storage.readRoot(); } catch { return failure("storage-unavailable"); }
    if (!rawRead.ok) return rawRead;
    const rawFingerprint = safeValue(() => dependencies.rawFingerprint(rawRead.value), "validation");
    if (!rawFingerprint.ok) return rawFingerprint;
    const current = safely(() => dependencies.policy.decodeAndMigrate(rawRead.value), "validation");
    let storedRevision: number;
    if (mode === "normal") {
      if (!current.ok) return current;
      const revision = safeValue(() => dependencies.policy.revision(current.value), "validation");
      if (!revision.ok || !Number.isSafeInteger(revision.value) || revision.value < 0) return failure("validation");
      storedRevision = revision.value;
    } else {
      if (current.ok) return failure("stale-recovery-state");
      storedRevision = 0;
    }
    const persistent = await readControl();
    if (!persistent.ok) return persistent;
    const fenceValue = persistent.value;
    const fence = activeFence(fenceValue, mode);
    if (fence === undefined) return failure(mode === "normal" ? "stale-fence" : "stale-recovery-state");

    const decoded = safely(() => dependencies.policy.decodeAndMigrate(candidateInput), "validation");
    if (!decoded.ok) return decoded;
    const repaired = safely(() => dependencies.policy.repair(decoded.value, current.ok ? current.value : decoded.value), "repair");
    if (!repaired.ok) return repaired;
    const validated = safely(() => dependencies.policy.decodeAndMigrate(repaired.value), "validation");
    if (!validated.ok) return validated;
    let currentBytes: CoreResult<number, CoreError>;
    try { currentBytes = await dependencies.storage.bytesInUse(); } catch { return failure("storage-unavailable"); }
    if (!currentBytes.ok) return currentBytes;
    const quota = safeValue(() => dependencies.storage.quotaBytes(), "storage-unavailable");
    if (!quota.ok) return quota;
    const capacity = safely(() => dependencies.capacity.assess(currentBytes.value, validated.value, quota.value), "quota-exceeded");
    if (!capacity.ok) return capacity;
    const digest = safeValue(() => dependencies.candidateDigest(validated.value), "validation");
    if (!digest.ok) return digest;
    const preview = safeValue(() => dependencies.preview(validated.value, capacity.value, mode), "validation");
    if (!preview.ok) return preview;
    const id = identifier();
    if (!id.ok) return id;
    return { ok: true, value: { candidate: validated.value, preview: preview.value, binding: { id: id.value, mode, candidateDigest: digest.value, storedRevision, rawFingerprint: rawFingerprint.value, owner: fence.owner, generation: fence.generation } } };
  };

  const assessMode = async (candidate: unknown, mode: ReplacementMode): Promise<CoreResult<ReplacementAssessment<Preview>, CoreError>> => {
    const evaluated = await evaluate(candidate, mode);
    if (!evaluated.ok) return evaluated;
    const ticket = Object.freeze({}) as ReplacementAssessmentTicket;
    bindings.set(ticket, evaluated.value.binding);
    return { ok: true, value: { preview: evaluated.value.preview, ticket } };
  };
  return {
    assess: (candidate) => assessMode(candidate, "normal"),
    assessRecovery: (candidate) => assessMode(candidate, "recovery"),
    async commit(input) {
      const binding = bindings.get(input.ticket as object);
      if (binding === undefined || binding.mode !== input.mode) return failure("stale-assessment");
      const staleAssessment = () => {
        bindings.delete(input.ticket as object);
        return failure("stale-assessment");
      };
      try {
        const locked = await dependencies.lock.runExclusive(async () => {
          const persistent = await readControl();
          if (!persistent.ok) return persistent;
          const existing = pendingFrom(persistent.value);
          const persistentFence = activeFence(persistent.value, input.mode);
          if (
            persistentFence?.owner !== binding.owner ||
            persistentFence.generation !== binding.generation
          )
            return staleAssessment();
          const raw = await dependencies.storage.readRoot().catch(() => failure("storage-unavailable"));
          if (!raw.ok) return raw;
          if (existing !== undefined) {
            if (existing.ticketId !== binding.id) return failure("recovery-active");
            const committed = safely(() => dependencies.policy.decodeAndMigrate(raw.value), "validation");
            if (committed.ok && dependencies.policy.revision(committed.value) === existing.revision && dependencies.candidateDigest(committed.value) === existing.candidateDigest) {
              const bytes = await dependencies.storage.bytesInUse().catch(() => failure("storage-unavailable"));
              if (!bytes.ok) return bytes;
              const quota = safeValue(() => dependencies.storage.quotaBytes(), "storage-unavailable");
              if (!quota.ok) return quota;
              const capacity = safely(() => dependencies.capacity.assess(bytes.value, committed.value, quota.value), "quota-exceeded");
              if (!capacity.ok) return capacity;
              const finalization = Object.freeze({}) as FinalizationTicket;
              finalizations.set(finalization as object, existing);
              bindings.delete(input.ticket as object);
              return { ok: true as const, value: { kind: "committed-finalization-required" as const, receipt: { root: committed.value, revision: existing.revision, capacity: capacity.value }, finalization } };
            }
            const cleaned = await writeControl(withPending(persistent.value, undefined));
            if (!cleaned.ok) return failure("precommit-cleanup-pending");
            return failure("precommit-cleanup-pending");
          }
          const fingerprint = safeValue(() => dependencies.rawFingerprint(raw.value), "validation");
          if (!fingerprint.ok) return fingerprint;
          const decoded = safely(() => dependencies.policy.decodeAndMigrate(raw.value), "validation");
          let revision = 0;
          if (input.mode === "normal") {
            if (!decoded.ok) return staleAssessment();
            const currentRevision = safeValue(() => dependencies.policy.revision(decoded.value), "validation");
            if (!currentRevision.ok) return staleAssessment();
            revision = currentRevision.value;
          } else {
            if (decoded.ok) {
              bindings.delete(input.ticket as object);
              return failure("stale-recovery-state");
            }
          }
          if (fingerprint.value !== binding.rawFingerprint || revision !== binding.storedRevision)
            return staleAssessment();

          const candidate = safely(() => dependencies.policy.decodeAndMigrate(input.candidate), "validation");
          if (!candidate.ok) return candidate;
          const repaired = safely(() => dependencies.policy.repair(candidate.value, decoded.ok ? decoded.value : candidate.value), "repair");
          if (!repaired.ok) return repaired;
          const digest = safeValue(() => dependencies.candidateDigest(repaired.value), "validation");
          if (!digest.ok) return digest;
          if (digest.value !== binding.candidateDigest) return staleAssessment();
          if (revision >= Number.MAX_SAFE_INTEGER) return failure("validation");
          const nextRevision = input.mode === "normal" ? revision + 1 : Math.max(1, dependencies.policy.revision(repaired.value));
          let committedRoot = dependencies.policy.withRevision(repaired.value, nextRevision);
          committedRoot = dependencies.policy.withControl(committedRoot, {
            active: false,
            generation: binding.generation,
          } as Control);
          const validated = safely(() => dependencies.policy.decodeAndMigrate(committedRoot), "validation");
          if (!validated.ok) return validated;
          const committedDigest = safeValue(() => dependencies.candidateDigest(validated.value), "validation");
          if (!committedDigest.ok) return committedDigest;
          const bytes = await dependencies.storage.bytesInUse().catch(() => failure("storage-unavailable"));
          if (!bytes.ok) return bytes;
          const quota = safeValue(() => dependencies.storage.quotaBytes(), "storage-unavailable");
          if (!quota.ok) return quota;
          const capacity = safely(() => dependencies.capacity.assess(bytes.value, validated.value, quota.value), "quota-exceeded");
          if (!capacity.ok) return capacity;
          const receipt: ReplacementReceipt<Root> = { root: validated.value, revision: nextRevision, capacity: capacity.value };
          const finalizationId = identifier();
          if (!finalizationId.ok) return finalizationId;
          const pending: PendingCommit = { ticketId: binding.id, finalizationId: finalizationId.value, mode: binding.mode, candidateDigest: committedDigest.value, revision: nextRevision, owner: binding.owner, generation: binding.generation };
          const prepared = await writeControl(withPending(persistent.value, pending));
          if (!prepared.ok) return prepared;
          const rootWrite = await dependencies.storage.writeRoot(validated.value).catch(() => failure("storage-unavailable"));
          if (!rootWrite.ok) {
            const cleaned = await writeControl(withPending(persistent.value, undefined));
            return cleaned.ok ? rootWrite : failure("precommit-cleanup-pending");
          }
          bindings.delete(input.ticket as object);
          const finalization = Object.freeze({}) as FinalizationTicket;
          finalizations.set(finalization as object, pending);
          const cleaned = await writeControl({ active: false, generation: binding.generation } as Control);
          return cleaned.ok
            ? { ok: true as const, value: { kind: "committed" as const, receipt } }
            : { ok: true as const, value: { kind: "committed-finalization-required" as const, receipt, finalization } };
        });
        return locked.ok ? locked.value : locked;
      } catch { return failure("lock-unavailable"); }
    },
    async findPendingFinalization() {
      const control = await readControl();
      if (!control.ok) return control;
      const pending = pendingFrom(control.value);
      if (pending === undefined) return { ok: true, value: null };
      const raw = await dependencies.storage.readRoot().catch(() => failure("storage-unavailable"));
      if (!raw.ok) return raw;
      const decoded = safely(() => dependencies.policy.decodeAndMigrate(raw.value), "validation");
      if (!decoded.ok || dependencies.policy.revision(decoded.value) !== pending.revision) return { ok: true, value: null };
      const digest = safeValue(() => dependencies.candidateDigest(decoded.value), "validation");
      if (!digest.ok || digest.value !== pending.candidateDigest) return { ok: true, value: null };
      const ticket = Object.freeze({}) as FinalizationTicket;
      finalizations.set(ticket as object, pending);
      return { ok: true, value: ticket };
    },
    async finalize(ticket) {
      const pending = finalizations.get(ticket as object);
      if (pending === undefined) return failure("stale-assessment");
      try {
        const locked = await dependencies.lock.runExclusive(async () => {
          const control = await readControl();
          if (!control.ok) return control;
          const stored = pendingFrom(control.value);
          if (stored?.finalizationId !== pending.finalizationId) return failure("stale-assessment");
          const raw = await dependencies.storage.readRoot().catch(() => failure("storage-unavailable"));
          if (!raw.ok) return raw;
          const decoded = safely(() => dependencies.policy.decodeAndMigrate(raw.value), "validation");
          if (!decoded.ok || dependencies.policy.revision(decoded.value) !== pending.revision) return failure("stale-assessment");
          const digest = safeValue(() => dependencies.candidateDigest(decoded.value), "validation");
          if (!digest.ok || digest.value !== pending.candidateDigest) return failure("stale-assessment");
          const bytes = await dependencies.storage.bytesInUse().catch(() => failure("storage-unavailable"));
          if (!bytes.ok) return bytes;
          const quota = safeValue(() => dependencies.storage.quotaBytes(), "storage-unavailable");
          if (!quota.ok) return quota;
          const capacity = safely(() => dependencies.capacity.assess(bytes.value, decoded.value, quota.value), "quota-exceeded");
          if (!capacity.ok) return capacity;
          const releasedControl = { active: false, generation: pending.generation } as Control;
          const released = await writeControl(releasedControl);
          if (!released.ok) return released;
          finalizations.delete(ticket as object);
          const releasedRoot = dependencies.policy.withControl(decoded.value, releasedControl);
          return { ok: true as const, value: { root: releasedRoot, revision: pending.revision, capacity: capacity.value } };
        });
        return locked.ok ? locked.value : locked;
      } catch { return failure("lock-unavailable"); }
    },
  };
};
