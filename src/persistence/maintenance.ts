import type { Revision, UtcTimestamp } from "../domain/identifiers.js";
import type {
  LocalDataRoot,
  MaintenanceGeneration,
  MaintenanceOwnerId,
} from "../domain/model.js";
import type { Result } from "../domain/result.js";

export interface MaintenanceFence {
  readonly generation: MaintenanceGeneration;
  readonly ownerId: MaintenanceOwnerId;
  readonly revision: Revision;
}

export interface MaintenanceTransition {
  /** RootTransactionRunner が revision を進める前の永続化候補。 */
  readonly root: LocalDataRoot;
  /** candidate の commit 後にだけ有効になる fence。 */
  readonly fence?: MaintenanceFence;
}

export type MaintenanceError =
  | { readonly code: "validation" }
  | { readonly code: "corrupt-data" }
  | { readonly code: "maintenance-active" }
  | { readonly code: "stale-fence" };

export interface MaintenancePolicy {
  acquire(
    root: LocalDataRoot,
    ownerId: MaintenanceOwnerId,
    leaseMs: number,
    now: UtcTimestamp,
  ): Result<MaintenanceTransition, MaintenanceError>;
  renew(
    root: LocalDataRoot,
    fence: MaintenanceFence,
    leaseMs: number,
    now: UtcTimestamp,
  ): Result<MaintenanceTransition, MaintenanceError>;
  release(
    root: LocalDataRoot,
    fence: MaintenanceFence,
  ): Result<MaintenanceTransition, MaintenanceError>;
  abort(
    root: LocalDataRoot,
    fence: MaintenanceFence,
  ): Result<MaintenanceTransition, MaintenanceError>;
  authorizeWrite(
    root: LocalDataRoot,
    fence: MaintenanceFence | undefined,
    now: UtcTimestamp,
  ): Result<void, MaintenanceError>;
}

const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUtc = (value: unknown): value is UtcTimestamp =>
  typeof value === "string" &&
  UTC_PATTERN.test(value) &&
  Number.isFinite(Date.parse(value));

const isSafeRevision = (value: unknown): value is Revision =>
  Number.isSafeInteger(value) && (value as number) >= 0;

const isSafeGeneration = (value: unknown): value is MaintenanceGeneration =>
  Number.isSafeInteger(value) && (value as number) >= 0;

const hasValidMaintenanceState = (root: LocalDataRoot): boolean => {
  if (!isSafeRevision(root.revision)) return false;
  const state = root.maintenance;
  if (
    typeof state !== "object" ||
    state === null ||
    !isSafeGeneration(state.generation) ||
    typeof state.active !== "boolean"
  ) {
    return false;
  }
  if (!state.active) {
    return !("ownerId" in state) && !("leaseExpiresAt" in state);
  }
  return UUID_PATTERN.test(state.ownerId) && isUtc(state.leaseExpiresAt);
};

const nextRevision = (revision: Revision): Revision | undefined => {
  const next = revision + 1;
  return Number.isSafeInteger(next) ? (next as Revision) : undefined;
};

const parseNow = (now: UtcTimestamp): number | undefined =>
  isUtc(now) ? Date.parse(now) : undefined;

const leaseExpiry = (
  leaseMs: number,
  now: UtcTimestamp,
): Result<UtcTimestamp, MaintenanceError> => {
  const current = parseNow(now);
  if (current === undefined || !Number.isSafeInteger(leaseMs) || leaseMs <= 0) {
    return err({ code: "validation" });
  }
  const expiry = current + leaseMs;
  return Number.isSafeInteger(expiry)
    ? ok(new Date(expiry).toISOString() as UtcTimestamp)
    : err({ code: "validation" });
};

const matches = (root: LocalDataRoot, fence: MaintenanceFence): boolean =>
  root.maintenance.active &&
  root.maintenance.generation === fence.generation &&
  root.maintenance.ownerId === fence.ownerId &&
  root.revision === fence.revision;

const finish = (
  root: LocalDataRoot,
  fence: MaintenanceFence,
): Result<MaintenanceTransition, MaintenanceError> => {
  if (!hasValidMaintenanceState(root)) return err({ code: "corrupt-data" });
  if (!matches(root, fence)) return err({ code: "stale-fence" });
  return ok({
    root: {
      ...root,
      maintenance: { active: false, generation: fence.generation },
    },
  });
};

export const maintenancePolicy: MaintenancePolicy = {
  acquire(root, ownerId, leaseMs, now) {
    if (!hasValidMaintenanceState(root)) return err({ code: "corrupt-data" });
    if (!UUID_PATTERN.test(ownerId)) return err({ code: "validation" });
    const expiry = leaseExpiry(leaseMs, now);
    if (!expiry.ok) return expiry;
    const current = parseNow(now) as number;
    if (
      root.maintenance.active &&
      Date.parse(root.maintenance.leaseExpiresAt) > current
    ) {
      return err({ code: "maintenance-active" });
    }
    const revision = nextRevision(root.revision);
    const generation = root.maintenance.generation + 1;
    if (revision === undefined || !Number.isSafeInteger(generation)) {
      return err({ code: "corrupt-data" });
    }
    const typedGeneration = generation as MaintenanceGeneration;
    const fence = { generation: typedGeneration, ownerId, revision };
    return ok({
      root: {
        ...root,
        maintenance: {
          active: true,
          generation: typedGeneration,
          ownerId,
          leaseExpiresAt: expiry.value,
        },
      },
      fence,
    });
  },

  renew(root, fence, leaseMs, now) {
    if (!hasValidMaintenanceState(root)) return err({ code: "corrupt-data" });
    const expiry = leaseExpiry(leaseMs, now);
    if (!expiry.ok) return expiry;
    if (
      !matches(root, fence) ||
      !root.maintenance.active ||
      Date.parse(root.maintenance.leaseExpiresAt) <= (parseNow(now) as number)
    ) {
      return err({ code: "stale-fence" });
    }
    const revision = nextRevision(root.revision);
    if (revision === undefined) return err({ code: "corrupt-data" });
    return ok({
      root: {
        ...root,
        maintenance: { ...root.maintenance, leaseExpiresAt: expiry.value },
      },
      fence: { ...fence, revision },
    });
  },

  release(root, fence) {
    return finish(root, fence);
  },

  abort(root, fence) {
    return finish(root, fence);
  },

  authorizeWrite(root, fence, now) {
    if (!hasValidMaintenanceState(root)) return err({ code: "corrupt-data" });
    const current = parseNow(now);
    if (current === undefined) return err({ code: "validation" });
    if (!root.maintenance.active) {
      return fence === undefined ? ok(undefined) : err({ code: "stale-fence" });
    }
    if (fence === undefined) return err({ code: "maintenance-active" });
    if (
      !matches(root, fence) ||
      Date.parse(root.maintenance.leaseExpiresAt) <= current
    ) {
      return err({ code: "stale-fence" });
    }
    return ok(undefined);
  },
};
