export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export type FoundationErrorCode =
  | "validation"
  | "corrupt-data"
  | "unsupported-version"
  | "migration-failed"
  | "repair-failed"
  | "revision-conflict"
  | "request-conflict"
  | "maintenance-active"
  | "recovery-active"
  | "stale-recovery-state"
  | "stale-fence"
  | "stale-assessment"
  | "precommit-cleanup-pending"
  | "quota-exceeded"
  | "access-denied"
  | "lock-unavailable"
  | "storage-unavailable";

export type FoundationError = {
  readonly [Code in FoundationErrorCode]: Code extends "validation"
    ? {
        readonly code: Code;
        readonly reason?: "entity-already-exists" | "entity-not-found";
        readonly message?: string;
      }
    : {
        readonly code: Code;
        readonly message?: string;
      };
}[FoundationErrorCode];
