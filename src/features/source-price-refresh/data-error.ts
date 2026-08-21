import type { AppDataError } from "../../domain/public.js";
import type { SourcePriceRefreshStorageError } from "./contracts.js";

export const sourcePriceRefreshDataError = (
  error: AppDataError,
): SourcePriceRefreshStorageError => {
  switch (error.code) {
    case "validation":
    case "repair-failed":
    case "recovery-active":
    case "stale-recovery-state":
    case "stale-assessment":
    case "precommit-cleanup-pending":
      return { kind: "validation" };
    case "revision-conflict":
    case "request-conflict":
      return { kind: "conflict" };
    case "maintenance-active":
    case "stale-fence":
      return { kind: "maintenance" };
    case "quota-exceeded":
      return { kind: "quota" };
    case "corrupt-data":
    case "unsupported-version":
    case "migration-failed":
      return { kind: "unsupported-data" };
    case "access-denied":
    case "lock-unavailable":
    case "storage-unavailable":
      return { kind: "storage" };
    default: {
      const exhaustive: never = error;
      return exhaustive;
    }
  }
};
