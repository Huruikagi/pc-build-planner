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
  | "stale-fence"
  | "stale-assessment"
  | "quota-exceeded"
  | "access-denied"
  | "lock-unavailable"
  | "storage-unavailable";

export type FoundationError = {
  readonly [Code in FoundationErrorCode]: {
    readonly code: Code;
    readonly message?: string;
  };
}[FoundationErrorCode];
