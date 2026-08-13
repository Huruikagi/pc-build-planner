import type {
  CapacityPolicy,
  CapacityStatus,
  CoreResult,
} from "./contracts.js";

const DEFAULT_WARNING_RATIO = 0.8;

export type SerializedBytes<Root> = (candidate: Root) => number;

export const createCapacityPolicy = <Root>(
  serializedBytes: SerializedBytes<Root>,
  warningRatio = DEFAULT_WARNING_RATIO,
): CapacityPolicy<Root> => {
  if (!Number.isFinite(warningRatio) || warningRatio <= 0 || warningRatio > 1) {
    throw new RangeError("warningRatio must be greater than 0 and at most 1");
  }

  return {
    assess(currentBytes, candidate, quotaBytes) {
      const afterBytes = serializedBytes(candidate);
      if (afterBytes > quotaBytes) {
        return { ok: false, error: { code: "quota-exceeded" } };
      }

      const warningThresholdBytes = quotaBytes * warningRatio;
      const status: CapacityStatus = {
        beforeBytes: currentBytes,
        afterBytes,
        warningThresholdBytes,
        quotaBytes,
        warning: afterBytes >= warningThresholdBytes,
      };
      return { ok: true, value: status } satisfies CoreResult<
        CapacityStatus,
        never
      >;
    },
  };
};
