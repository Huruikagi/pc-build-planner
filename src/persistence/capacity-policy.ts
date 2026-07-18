import type { LocalDataRoot } from "../domain/model.js";
import type { FoundationError, Result } from "../domain/result.js";
import type { StorageError, StoragePort } from "./repository.js";

const DEFAULT_WARNING_RATIO = 0.8;
const STORAGE_KEY = "localDataRoot";

export interface CapacityWarning {
  readonly code: "capacity-warning";
  readonly thresholdBytes: number;
}

export interface CapacityStatus {
  readonly beforeBytes: number;
  readonly afterBytes: number;
  readonly requiredBytes: number;
  readonly quotaBytes: number;
  readonly warningThresholdBytes: number;
  readonly warnings: readonly CapacityWarning[];
}

export type CapacityError =
  | StorageError
  | Extract<FoundationError, { readonly code: "quota-exceeded" }>;

export interface CapacityPolicy {
  assess(root: LocalDataRoot): Promise<Result<CapacityStatus, CapacityError>>;
}

const serializedRootBytes = (root: LocalDataRoot): number =>
  new TextEncoder().encode(JSON.stringify({ [STORAGE_KEY]: root })).byteLength;
const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const createCapacityPolicy = (
  storage: StoragePort,
  warningRatio = DEFAULT_WARNING_RATIO,
): CapacityPolicy => {
  if (!Number.isFinite(warningRatio) || warningRatio <= 0 || warningRatio > 1) {
    throw new RangeError("warningRatio must be greater than 0 and at most 1");
  }

  return {
    async assess(root) {
      const before = await storage.bytesInUse();
      if (!before.ok) return err(before.error);

      const quotaBytes = storage.quotaBytes();
      const requiredBytes = serializedRootBytes(root);
      if (requiredBytes > quotaBytes) return err({ code: "quota-exceeded" });

      const warningThresholdBytes = quotaBytes * warningRatio;
      const warnings: readonly CapacityWarning[] =
        requiredBytes >= warningThresholdBytes
          ? [
              {
                code: "capacity-warning",
                thresholdBytes: warningThresholdBytes,
              },
            ]
          : [];
      return ok({
        beforeBytes: before.value,
        afterBytes: requiredBytes,
        requiredBytes,
        quotaBytes,
        warningThresholdBytes,
        warnings,
      });
    },
  };
};
