import { message } from "../ui-messages/public.js";
import type {
  FoundationMaintenanceSnapshot,
  MaintenanceCursor,
  MaintenanceProjection,
  ShellMaintenanceState,
} from "./contracts.js";

export const MAINTENANCE_ACTIVE_MESSAGE = message("shell.maintenanceActive");
export const RECOVERY_REQUIRED_MESSAGE = message("shell.recoveryRequired");

const INVALID_CURSOR_MESSAGE =
  "maintenance cursor must contain non-negative finite integers";

export function createMaintenanceProjection(): MaintenanceProjection {
  let current = inactiveState({ generation: 0, revision: 0 });
  let currentCursor: MaintenanceCursor = { generation: 0, revision: 0 };
  // 起動直後の初期cursorは「未受信」を表す暫定値であり、Foundationの実cursorと
  // 比較可能な観測値ではない。最初の受理だけは比較せず必ず適用しないと、
  // 空ストレージ起動時の実snapshot（generation 0 / revision 0）が
  // 構造的にstale扱いとなり初期状態を取り込めない。
  let seeded = false;
  const listeners = new Set<(state: ShellMaintenanceState) => void>();

  return {
    accept(next) {
      validateCursor(next);
      const nextCursor = {
        generation: next.generation,
        revision: next.revision,
      };
      if (seeded && compareCursor(nextCursor, currentCursor) <= 0) {
        return "stale_ignored";
      }
      seeded = true;
      currentCursor = frozenCursor(nextCursor);

      current = next.active
        ? activeState(nextCursor)
        : inactiveState(nextCursor);
      notify(listeners, current);
      return "applied";
    },

    requireRecovery(reason) {
      // Recovery has no trustworthy maintenance cursor. A later valid snapshot
      // seeds the normal projection without comparing against an invented value.
      seeded = false;
      current = recoveryRequiredState(reason);
      notify(listeners, current);
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

function recoveryRequiredState(
  reason: "corrupt-data" | "unsupported-version",
): ShellMaintenanceState {
  return Object.freeze({
    status: "recovery-required" as const,
    reason,
    message: RECOVERY_REQUIRED_MESSAGE,
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
