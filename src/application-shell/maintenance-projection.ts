import type {
  FoundationMaintenanceSnapshot,
  MaintenanceCursor,
  MaintenanceProjection,
  ShellMaintenanceState,
} from "./contracts.js";

export const MAINTENANCE_ACTIVE_MESSAGE =
  "メンテナンス中です。変更操作は利用できません。";

const INVALID_CURSOR_MESSAGE =
  "maintenance cursor must contain non-negative finite integers";

export function createMaintenanceProjection(): MaintenanceProjection {
  let current = inactiveState({ generation: 0, revision: 0 });
  const listeners = new Set<(state: ShellMaintenanceState) => void>();

  return {
    accept(next) {
      validateCursor(next);
      const nextCursor = {
        generation: next.generation,
        revision: next.revision,
      };
      if (compareCursor(nextCursor, current.cursor) <= 0) {
        return "stale_ignored";
      }

      current = next.active
        ? activeState(nextCursor)
        : inactiveState(nextCursor);
      notify(listeners, current);
      return "applied";
    },

    getSnapshot() {
      return current;
    },

    subscribe(listener) {
      listeners.add(listener);
      let removed = false;
      return () => {
        if (removed) return;
        removed = true;
        listeners.delete(listener);
      };
    },
  };
}

function validateCursor(snapshot: FoundationMaintenanceSnapshot): void {
  if (
    !Number.isSafeInteger(snapshot.generation) ||
    snapshot.generation < 0 ||
    !Number.isSafeInteger(snapshot.revision) ||
    snapshot.revision < 0
  ) {
    throw new TypeError(INVALID_CURSOR_MESSAGE);
  }
}

function compareCursor(
  left: MaintenanceCursor,
  right: MaintenanceCursor,
): number {
  if (left.generation !== right.generation) {
    return left.generation < right.generation ? -1 : 1;
  }
  if (left.revision === right.revision) return 0;
  return left.revision < right.revision ? -1 : 1;
}

function inactiveState(cursor: MaintenanceCursor): ShellMaintenanceState {
  return Object.freeze({ status: "inactive", cursor: frozenCursor(cursor) });
}

function activeState(cursor: MaintenanceCursor): ShellMaintenanceState {
  return Object.freeze({
    status: "active",
    cursor: frozenCursor(cursor),
    message: MAINTENANCE_ACTIVE_MESSAGE,
  });
}

function frozenCursor(cursor: MaintenanceCursor): MaintenanceCursor {
  return Object.freeze({ ...cursor });
}

function notify(
  listeners: ReadonlySet<(state: ShellMaintenanceState) => void>,
  state: ShellMaintenanceState,
): void {
  for (const listener of listeners) {
    try {
      listener(state);
    } catch {
      // External presentation callbacks are isolated from projection progress.
    }
  }
}
