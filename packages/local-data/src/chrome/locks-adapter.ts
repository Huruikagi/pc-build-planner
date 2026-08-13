import type {
  CoreResult,
  ExclusiveLockPort,
  LockError,
} from "../contracts.js";

export interface ChromeLocksApi {
  request<T>(
    name: string,
    options: { readonly mode: "exclusive" },
    callback: () => Promise<T>,
  ): Promise<T>;
}

type CallbackOutcome<T> =
  | { readonly token: symbol; readonly ok: true; readonly value: T }
  | { readonly token: symbol; readonly ok: false; readonly cause: unknown };

const unavailable = <T>(): CoreResult<T, LockError> => ({
  ok: false,
  error: { code: "lock-unavailable" },
});

export const createChromeExclusiveLockAdapter = (
  locks: ChromeLocksApi,
  lockName: string,
): ExclusiveLockPort => ({
  async runExclusive<T>(operation: () => Promise<T>) {
    if (lockName.length === 0) return unavailable<T>();

    const token = Symbol("chrome-exclusive-lock-callback");
    let outcome: CallbackOutcome<T>;
    try {
      outcome = await locks.request(
        lockName,
        { mode: "exclusive" },
        async (): Promise<CallbackOutcome<T>> => {
          try {
            return { token, ok: true, value: await operation() };
          } catch (cause) {
            return { token, ok: false, cause };
          }
        },
      );
    } catch {
      return unavailable<T>();
    }

    if (outcome?.token !== token) return unavailable<T>();
    if (!outcome.ok) throw outcome.cause;
    return { ok: true, value: outcome.value };
  },
});
