import type { Result } from "../domain/result.js";

export interface RecoveryControl {
  readonly generation: number;
  readonly active: boolean;
  readonly ownerId?: string;
  readonly leaseExpiresAt?: string;
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
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
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
  ]);
  if (
    keys.some((key) => !allowed.has(key)) ||
    !Number.isSafeInteger(value.generation) ||
    (value.generation as number) < 0 ||
    typeof value.active !== "boolean"
  )
    return { ok: false, error: { code: "invalid-recovery-control" } };
  if (!value.active) {
    if ("ownerId" in value || "leaseExpiresAt" in value)
      return { ok: false, error: { code: "invalid-recovery-control" } };
    return { ok: true, value: inactive(value.generation as number) };
  }
  if (
    typeof value.ownerId !== "string" ||
    value.ownerId.length === 0 ||
    !isUtc(value.leaseExpiresAt)
  )
    return { ok: false, error: { code: "invalid-recovery-control" } };
  return {
    ok: true,
    value: {
      generation: value.generation as number,
      active: true,
      ownerId: value.ownerId,
      leaseExpiresAt: value.leaseExpiresAt,
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

export const recoveryControlPolicy = {
  acquire(
    control: RecoveryControl,
    ownerId: string,
    leaseExpiresAt: string,
  ): Result<
    { readonly control: RecoveryControl; readonly fence: RecoveryFence },
    RecoveryControlError
  > {
    if (control.active || ownerId.length === 0 || !isUtc(leaseExpiresAt))
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
  ): Result<RecoveryControl, RecoveryControlError> {
    if (!matches(control, fence) || !isUtc(leaseExpiresAt))
      return { ok: false, error: { code: "stale-recovery-state" } };
    return { ok: true, value: { ...control, leaseExpiresAt } };
  },
  release(
    control: RecoveryControl,
    fence: RecoveryFence,
  ): Result<RecoveryControl, RecoveryControlError> {
    return matches(control, fence)
      ? { ok: true, value: inactive(control.generation) }
      : { ok: false, error: { code: "stale-recovery-state" } };
  },
  abort(
    control: RecoveryControl,
    fence: RecoveryFence,
  ): Result<RecoveryControl, RecoveryControlError> {
    return this.release(control, fence);
  },
  authorizeNormalWrite(
    control: RecoveryControl,
  ): Result<void, RecoveryControlError> {
    return control.active
      ? { ok: false, error: { code: "recovery-active" } }
      : { ok: true, value: undefined };
  },
};
