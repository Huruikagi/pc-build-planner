import type {
  MaintenancePresentationPort,
  MutationGate,
  OperationKind,
} from "./contracts.js";

export function createMutationGate(
  maintenance: MaintenancePresentationPort,
): MutationGate {
  const isAllowed = (kind: OperationKind): boolean => {
    const state = maintenance.getSnapshot();
    if (kind === "read") return true;
    if (kind === "mutation") return state.status === "inactive";
    return kind === "recovery" && state.status !== "active";
  };

  const listeners = new Set<() => void>();
  let unsubscribeMaintenance: (() => void) | undefined;
  const allowedMask = (): number =>
    (isAllowed("mutation") ? 2 : 0) + (isAllowed("recovery") ? 1 : 0);
  let lastAllowedMask = allowedMask();

  /** Only an actual change of the allowed set reaches subscribers. */
  const onMaintenanceChange = (): void => {
    const next = allowedMask();
    if (next === lastAllowedMask) return;
    lastAllowedMask = next;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // Feature callbacks are isolated from gate progress.
      }
    }
  };

  return {
    isAllowed,

    subscribe(listener: () => void): () => void {
      if (listeners.size === 0) {
        lastAllowedMask = allowedMask();
        unsubscribeMaintenance = maintenance.subscribe(onMaintenanceChange);
      }
      listeners.add(listener);
      let removed = false;
      return () => {
        if (removed) return;
        removed = true;
        listeners.delete(listener);
        if (listeners.size > 0) return;
        const owned = unsubscribeMaintenance;
        unsubscribeMaintenance = undefined;
        try {
          owned?.();
        } catch {
          // Detaching from the projection is best-effort at teardown.
        }
      };
    },
  };
}
