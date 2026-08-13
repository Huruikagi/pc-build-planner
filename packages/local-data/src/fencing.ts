import type { CoreError, CoreResult } from "./contracts.js";

export type FenceKind = "maintenance" | "recovery";

export interface Fence {
  readonly kind: FenceKind;
  readonly owner: string;
  readonly generation: number;
  readonly leaseExpiresAt: number;
  readonly revision: number;
}

export type FenceControlState =
  | { readonly active: false; readonly generation: number }
  | ({ readonly active: true } & Fence);

export interface FencingProjection<Root> {
  revision(root: Root): number;
  read(root: Root): unknown;
  write(root: Root, control: FenceControlState): Root;
}

export interface AcquireFenceInput {
  readonly kind: FenceKind;
  readonly owner: string;
  readonly leaseMs: number;
  readonly now: number;
}

export interface FenceTransition<Root> {
  readonly root: Root;
  readonly fence: Fence;
}

export interface FenceCompletion<Root> {
  readonly root: Root;
}

export interface FencingPolicy<Root> {
  acquire(
    root: Root,
    input: AcquireFenceInput,
  ): CoreResult<FenceTransition<Root>, CoreError>;
  renew(
    root: Root,
    fence: Fence,
    leaseMs: number,
    now: number,
  ): CoreResult<FenceTransition<Root>, CoreError>;
  release(
    root: Root,
    fence: Fence,
  ): CoreResult<FenceCompletion<Root>, CoreError>;
  abort(
    root: Root,
    fence: Fence,
  ): CoreResult<FenceCompletion<Root>, CoreError>;
  authorizeMutation(
    root: Root,
    fence: Fence | undefined,
    now: number,
  ): CoreResult<void, CoreError>;
}

const staleFence = (): CoreResult<never, CoreError> => ({
  ok: false,
  error: { code: "stale-fence" },
});

const isSafeCounter = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isFiniteTimestamp = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const isKind = (value: unknown): value is FenceKind =>
  value === "maintenance" || value === "recovery";

const decodeControl = (value: unknown): FenceControlState | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const input = value as Record<string, unknown>;
  if (input.active === false && isSafeCounter(input.generation)) {
    return { active: false, generation: input.generation };
  }
  if (
    input.active === true &&
    isKind(input.kind) &&
    typeof input.owner === "string" &&
    input.owner.length > 0 &&
    isSafeCounter(input.generation) &&
    input.generation > 0 &&
    isFiniteTimestamp(input.leaseExpiresAt) &&
    isSafeCounter(input.revision)
  ) {
    return {
      active: true,
      kind: input.kind,
      owner: input.owner,
      generation: input.generation,
      leaseExpiresAt: input.leaseExpiresAt,
      revision: input.revision,
    };
  }
  return undefined;
};

const sameFence = (control: FenceControlState, fence: Fence): boolean =>
  control.active &&
  control.kind === fence.kind &&
  control.owner === fence.owner &&
  control.generation === fence.generation &&
  control.leaseExpiresAt === fence.leaseExpiresAt &&
  control.revision === fence.revision;

const activeError = (kind: FenceKind): CoreResult<never, CoreError> => ({
  ok: false,
  error: { code: kind === "maintenance" ? "maintenance-active" : "recovery-active" },
});

export const createFencingPolicy = <Root>(
  projection: FencingProjection<Root>,
): FencingPolicy<Root> => {
  const current = (
    root: Root,
  ): { readonly control: FenceControlState; readonly revision: number } | undefined => {
    const control = decodeControl(projection.read(root));
    const revision = projection.revision(root);
    if (
      control === undefined ||
      !isSafeCounter(revision) ||
      (control.active && control.revision !== revision)
    ) {
      return undefined;
    }
    return { control, revision };
  };

  const finish = (
    root: Root,
    fence: Fence,
  ): CoreResult<FenceCompletion<Root>, CoreError> => {
    const persisted = current(root);
    if (
      persisted === undefined ||
      persisted.revision !== fence.revision ||
      !sameFence(persisted.control, fence)
    ) {
      return staleFence();
    }
    return {
      ok: true,
      value: {
        root: projection.write(root, {
          active: false,
          generation: fence.generation,
        }),
      },
    };
  };

  return {
    acquire(root, input) {
      const persisted = current(root);
      if (
        persisted === undefined ||
        !isKind(input.kind) ||
        input.owner.length === 0 ||
        !isFiniteTimestamp(input.now) ||
        !Number.isFinite(input.leaseMs) ||
        input.leaseMs <= 0 ||
        !Number.isSafeInteger(input.leaseMs) ||
        persisted.control.generation >= Number.MAX_SAFE_INTEGER
      ) {
        return staleFence();
      }
      if (
        persisted.control.active &&
        persisted.control.leaseExpiresAt > input.now
      ) {
        return activeError(persisted.control.kind);
      }
      const fence: Fence = {
        kind: input.kind,
        owner: input.owner,
        generation: persisted.control.generation + 1,
        leaseExpiresAt: input.now + input.leaseMs,
        revision: persisted.revision,
      };
      if (!Number.isSafeInteger(fence.leaseExpiresAt)) return staleFence();
      return {
        ok: true,
        value: {
          root: projection.write(root, { active: true, ...fence }),
          fence,
        },
      };
    },

    renew(root, fence, leaseMs, now) {
      const persisted = current(root);
      if (
        persisted === undefined ||
        !Number.isSafeInteger(leaseMs) ||
        leaseMs <= 0 ||
        !isFiniteTimestamp(now) ||
        persisted.revision !== fence.revision ||
        !sameFence(persisted.control, fence) ||
        !persisted.control.active ||
        persisted.control.leaseExpiresAt <= now
      ) {
        return staleFence();
      }
      const renewed: Fence = { ...fence, leaseExpiresAt: now + leaseMs };
      if (!Number.isSafeInteger(renewed.leaseExpiresAt)) return staleFence();
      return {
        ok: true,
        value: {
          root: projection.write(root, { active: true, ...renewed }),
          fence: renewed,
        },
      };
    },

    release: finish,
    abort: finish,

    authorizeMutation(root, fence, now) {
      const persisted = current(root);
      if (persisted === undefined || !isFiniteTimestamp(now)) return staleFence();
      if (!persisted.control.active) {
        return fence === undefined
          ? { ok: true, value: undefined }
          : staleFence();
      }
      if (fence === undefined) return activeError(persisted.control.kind);
      if (
        persisted.control.leaseExpiresAt <= now ||
        persisted.revision !== fence.revision ||
        !sameFence(persisted.control, fence)
      ) {
        return staleFence();
      }
      return { ok: true, value: undefined };
    },
  };
};
