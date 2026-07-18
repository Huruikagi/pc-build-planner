import type { Result } from "../domain/result.js";
import type { LockError, RootWriteLock } from "./root-write-lock.js";

export const ROOT_WRITE_LOCK_NAME = "pc-build-planner:local-data-root-write";

export interface WebLocksApi {
  request<T>(
    name: string,
    options: { readonly mode: "exclusive" },
    callback: () => Promise<T>,
  ): Promise<T>;
}

const unavailable = <T>(): Result<T, LockError> => ({
  ok: false,
  error: { code: "lock-unavailable" },
});

export const createWebLocksAdapter = (locks: WebLocksApi): RootWriteLock => ({
  async runExclusive<T>(operation: () => Promise<T>) {
    let callbackStarted = false;
    try {
      return await locks.request(
        ROOT_WRITE_LOCK_NAME,
        { mode: "exclusive" },
        async () => {
          callbackStarted = true;
          return { ok: true, value: await operation() };
        },
      );
    } catch (cause) {
      if (callbackStarted) throw cause;
      return unavailable<T>();
    }
  },
});
