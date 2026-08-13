import type { CapacityPolicy, CapacityStatus, CoreError, CoreResult, LocalDataPolicy, ReplacementAssessment, ReplacementAssessmentTicket, ReplacementMode, StoragePort } from "./contracts.js";

interface TicketBinding { readonly mode: ReplacementMode; readonly candidateDigest: string; readonly storedRevision: number; readonly rawFingerprint: string; readonly owner: string; readonly generation: number }

export interface ReplacementCoordinatorDependencies<Root, Operation, Control, Preview> {
  readonly storage: StoragePort<Root, Control>;
  readonly policy: LocalDataPolicy<Root, Operation, Control, CoreError>;
  readonly capacity: CapacityPolicy<Root>;
  readonly candidateDigest: (candidate: Root) => string;
  readonly rawFingerprint: (raw: unknown) => string;
  readonly preview: (candidate: Root, capacity: CapacityStatus, mode: ReplacementMode) => Preview;
}

export interface ReplacementCoordinator<Root, Preview> {
  assess(candidate: unknown): Promise<CoreResult<ReplacementAssessment<Preview>, CoreError>>;
  assessRecovery(candidate: unknown): Promise<CoreResult<ReplacementAssessment<Preview>, CoreError>>;
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

  const evaluate = async (candidateInput: unknown, mode: ReplacementMode): Promise<CoreResult<{ readonly candidate: Root; readonly preview: Preview; readonly binding: TicketBinding }, CoreError>> => {
    let rawRead: CoreResult<unknown | undefined, CoreError>;
    try { rawRead = await dependencies.storage.readRoot(); } catch { return failure("storage-unavailable"); }
    if (!rawRead.ok) return rawRead;
    const rawFingerprint = safeValue(() => dependencies.rawFingerprint(rawRead.value), "validation");
    if (!rawFingerprint.ok) return rawFingerprint;
    const current = safely(() => dependencies.policy.decodeAndMigrate(rawRead.value), "validation");
    let storedRevision: number;
    let fenceValue: unknown;
    if (mode === "normal") {
      if (!current.ok) return current;
      const revision = safeValue(() => dependencies.policy.revision(current.value), "validation");
      if (!revision.ok || !Number.isSafeInteger(revision.value) || revision.value < 0) return failure("validation");
      storedRevision = revision.value;
      const projected = safeValue(() => dependencies.policy.control(current.value), "stale-fence");
      if (!projected.ok) return projected;
      fenceValue = projected.value;
    } else {
      if (current.ok) return failure("stale-recovery-state");
      storedRevision = 0;
      try {
        const control = await dependencies.storage.readControl();
        if (!control.ok) return control;
        fenceValue = control.value;
      } catch { return failure("storage-unavailable"); }
    }
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
    return { ok: true, value: { candidate: validated.value, preview: preview.value, binding: { mode, candidateDigest: digest.value, storedRevision, rawFingerprint: rawFingerprint.value, owner: fence.owner, generation: fence.generation } } };
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
  };
};
