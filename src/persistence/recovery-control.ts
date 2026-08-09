import type { Result } from "../domain/result.js";

export interface RecoveryControl {
  readonly generation: number;
  readonly active: boolean;
  readonly ownerId?: string;
  readonly leaseExpiresAt?: string;
  readonly candidateDigest?: string;
  readonly expectedCommitRevision?: number;
  readonly assessmentTicketId?: string;
  readonly assessmentIdentity?: string;
  readonly finalizationTicketId?: string;
  readonly commitMode?: "normal" | "recovery";
}

export interface RecoveryFence {
  readonly generation: number;
  readonly ownerId: string;
  readonly leaseExpiresAt: string;
}

export type RecoveryControlError =
  | { readonly code: "recovery-active" }
  | { readonly code: "stale-recovery-state" }
  | { readonly code: "invalid-recovery-control" };

const inactive = (generation: number): RecoveryControl => ({
  generation,
  active: false,
});
export const initialRecoveryControl = (): RecoveryControl => inactive(0);

const isUtc = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
  Number.isFinite(Date.parse(value));

export const validateRecoveryControl = (
  input: unknown,
): Result<RecoveryControl, RecoveryControlError> => {
  if (input === undefined) return { ok: true, value: initialRecoveryControl() };
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return { ok: false, error: { code: "invalid-recovery-control" } };
  const value = input as Record<string, unknown>;
  const keys = Object.keys(value);
  const allowed = new Set([
    "generation",
    "active",
    "ownerId",
    "leaseExpiresAt",
    "candidateDigest",
    "expectedCommitRevision",
    "assessmentTicketId",
    "assessmentIdentity",
    "finalizationTicketId",
    "commitMode",
  ]);
  if (
    keys.some((key) => !allowed.has(key)) ||
    !Number.isSafeInteger(value.generation) ||
    (value.generation as number) < 0 ||
    typeof value.active !== "boolean"
  )
    return { ok: false, error: { code: "invalid-recovery-control" } };
  if (!value.active) {
    if (
      "ownerId" in value ||
      "leaseExpiresAt" in value ||
      "candidateDigest" in value ||
      "expectedCommitRevision" in value ||
      "assessmentTicketId" in value ||
      "assessmentIdentity" in value ||
      "finalizationTicketId" in value ||
      "commitMode" in value
    )
      return { ok: false, error: { code: "invalid-recovery-control" } };
    return { ok: true, value: inactive(value.generation as number) };
  }
  if (
    typeof value.ownerId !== "string" ||
    value.ownerId.length === 0 ||
    !isUtc(value.leaseExpiresAt)
  )
    return { ok: false, error: { code: "invalid-recovery-control" } };
  if (
    ("assessmentTicketId" in value &&
      (typeof value.assessmentTicketId !== "string" ||
        value.assessmentTicketId.length === 0)) ||
    ("assessmentIdentity" in value &&
      (typeof value.assessmentIdentity !== "string" ||
        value.assessmentIdentity.length === 0)) ||
    ("finalizationTicketId" in value &&
      (typeof value.finalizationTicketId !== "string" ||
        value.finalizationTicketId.length === 0 ||
        !("candidateDigest" in value))) ||
    ("commitMode" in value &&
      value.commitMode !== "normal" &&
      value.commitMode !== "recovery")
  )
    return { ok: false, error: { code: "invalid-recovery-control" } };
  if (
    ("candidateDigest" in value || "expectedCommitRevision" in value) &&
    (typeof value.candidateDigest !== "string" ||
      !/^[0-9a-f]{64}$/.test(value.candidateDigest) ||
      !Number.isSafeInteger(value.expectedCommitRevision) ||
      (value.expectedCommitRevision as number) < 0)
  )
    return { ok: false, error: { code: "invalid-recovery-control" } };
  return {
    ok: true,
    value: {
      generation: value.generation as number,
      active: true,
      ownerId: value.ownerId,
      leaseExpiresAt: value.leaseExpiresAt,
      ...("candidateDigest" in value
        ? {
            candidateDigest: value.candidateDigest as string,
            expectedCommitRevision: value.expectedCommitRevision as number,
          }
        : {}),
      ...("assessmentTicketId" in value
        ? { assessmentTicketId: value.assessmentTicketId as string }
        : {}),
      ...("assessmentIdentity" in value
        ? { assessmentIdentity: value.assessmentIdentity as string }
        : {}),
      ...("finalizationTicketId" in value
        ? { finalizationTicketId: value.finalizationTicketId as string }
        : {}),
      ...("commitMode" in value
        ? { commitMode: value.commitMode as "normal" | "recovery" }
        : {}),
    },
  };
};

const matches = (
  control: RecoveryControl,
  fence: RecoveryFence,
): control is RecoveryControl & {
  readonly active: true;
  readonly ownerId: string;
  readonly leaseExpiresAt: string;
} =>
  control.active &&
  control.generation === fence.generation &&
  control.ownerId === fence.ownerId &&
  control.leaseExpiresAt === fence.leaseExpiresAt;

const leaseIsLive = (fence: RecoveryFence, now?: string): boolean =>
  now === undefined ||
  (isUtc(now) && Date.parse(fence.leaseExpiresAt) > Date.parse(now));

export const recoveryControlPolicy = {
  acquire(
    control: RecoveryControl,
    ownerId: string,
    leaseExpiresAt: string,
    assessmentTicketId?: string,
    assessmentIdentity?: string,
    commitMode?: "normal" | "recovery",
  ): Result<
    { readonly control: RecoveryControl; readonly fence: RecoveryFence },
    RecoveryControlError
  > {
    if (
      control.active ||
      ownerId.length === 0 ||
      !isUtc(leaseExpiresAt) ||
      (assessmentTicketId !== undefined && assessmentTicketId.length === 0) ||
      (assessmentIdentity !== undefined && assessmentIdentity.length === 0)
    )
      return {
        ok: false,
        error: {
          code: control.active ? "recovery-active" : "invalid-recovery-control",
        },
      };
    const generation = control.generation + 1;
    const next: RecoveryControl = {
      generation,
      active: true,
      ownerId,
      leaseExpiresAt,
      ...(assessmentTicketId === undefined ? {} : { assessmentTicketId }),
      ...(assessmentIdentity === undefined ? {} : { assessmentIdentity }),
      ...(commitMode === undefined ? {} : { commitMode }),
    };
    return {
      ok: true,
      value: {
        control: next,
        fence: { generation, ownerId, leaseExpiresAt },
      },
    };
  },
  renew(
    control: RecoveryControl,
    fence: RecoveryFence,
    leaseExpiresAt: string,
    now?: string,
  ): Result<RecoveryControl, RecoveryControlError> {
    if (
      !matches(control, fence) ||
      !leaseIsLive(fence, now) ||
      !isUtc(leaseExpiresAt) ||
      (now !== undefined && Date.parse(leaseExpiresAt) <= Date.parse(now))
    )
      return { ok: false, error: { code: "stale-recovery-state" } };
    return { ok: true, value: { ...control, leaseExpiresAt } };
  },
  release(
    control: RecoveryControl,
    fence: RecoveryFence,
    now?: string,
  ): Result<RecoveryControl, RecoveryControlError> {
    return matches(control, fence) && leaseIsLive(fence, now)
      ? { ok: true, value: inactive(control.generation) }
      : { ok: false, error: { code: "stale-recovery-state" } };
  },
  abort(
    control: RecoveryControl,
    fence: RecoveryFence,
    now?: string,
  ): Result<RecoveryControl, RecoveryControlError> {
    return this.release(control, fence, now);
  },
  authorizeNormalWrite(
    control: RecoveryControl,
  ): Result<void, RecoveryControlError> {
    return control.active
      ? { ok: false, error: { code: "recovery-active" } }
      : { ok: true, value: undefined };
  },
  authorizeRecovery(
    control: RecoveryControl,
    fence: RecoveryFence,
    now?: string,
  ): Result<void, RecoveryControlError> {
    return matches(control, fence) && leaseIsLive(fence, now)
      ? { ok: true, value: undefined }
      : { ok: false, error: { code: "stale-recovery-state" } };
  },
  bindCommit(
    control: RecoveryControl,
    fence: RecoveryFence,
    candidateDigest: string,
    expectedCommitRevision: number,
    now?: string,
    finalizationTicketId?: string,
    commitMode?: "normal" | "recovery",
  ): Result<RecoveryControl, RecoveryControlError> {
    if (
      !matches(control, fence) ||
      !leaseIsLive(fence, now) ||
      !/^[0-9a-f]{64}$/.test(candidateDigest) ||
      !Number.isSafeInteger(expectedCommitRevision) ||
      expectedCommitRevision < 0 ||
      (finalizationTicketId !== undefined && finalizationTicketId.length === 0)
    )
      return { ok: false, error: { code: "stale-recovery-state" } };
    return {
      ok: true,
      value: {
        ...control,
        candidateDigest,
        expectedCommitRevision,
        ...(finalizationTicketId === undefined ? {} : { finalizationTicketId }),
        ...(commitMode === undefined ? {} : { commitMode }),
      },
    };
  },
};
