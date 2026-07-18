import type { Result } from "../domain/result.js";

export interface LockError {
  readonly code: "lock-unavailable";
}

export interface RootWriteLock {
  runExclusive<T>(operation: () => Promise<T>): Promise<Result<T, LockError>>;
}

export interface InMemoryRootWriteLockState {
  tail: Promise<void>;
}

export const createInMemoryRootWriteLockState =
  (): InMemoryRootWriteLockState => ({
    tail: Promise.resolve(),
  });

export const createInMemoryRootWriteLock = (
  state: InMemoryRootWriteLockState = createInMemoryRootWriteLockState(),
): RootWriteLock => ({
  async runExclusive<T>(operation: () => Promise<T>) {
    const previous = state.tail;
    let release = (): void => undefined;
    state.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return { ok: true, value: await operation() };
    } finally {
      release();
    }
  },
});
