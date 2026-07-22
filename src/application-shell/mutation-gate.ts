import type {
  MaintenancePresentationPort,
  MutationGate,
  OperationKind,
} from "./contracts.js";

export function createMutationGate(
  maintenance: MaintenancePresentationPort,
): MutationGate {
  const isAllowed = (kind: OperationKind): boolean =>
    kind === "read" || maintenance.getSnapshot().status !== "active";

  const listeners = new Set<() => void>();
  let unsubscribeMaintenance: (() => void) | undefined;
  let lastMutationAllowed = isAllowed("mutation");

  /** Only an actual change of the allowed set reaches subscribers. */
  const onMaintenanceChange = (): void => {
    const next = isAllowed("mutation");
    if (next === lastMutationAllowed) return;
    lastMutationAllowed = next;
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
        lastMutationAllowed = isAllowed("mutation");
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
