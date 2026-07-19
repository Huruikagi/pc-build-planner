import type {
  MaintenancePresentationPort,
  MutationGate,
  OperationKind,
} from "./contracts.js";

export function createMutationGate(
  maintenance: MaintenancePresentationPort,
): MutationGate {
  return {
    isAllowed(kind: OperationKind): boolean {
      if (kind === "read") return true;
      return maintenance.getSnapshot().status !== "active";
    },
  };
}
