import {
  createTransactionEngine,
  type TransactionEngineDependencies,
} from "@pc-build-planner/local-data";

type RootMaintenanceControl = { readonly maintenanceToken: string };
type PersistentRecoveryControl = { readonly recoveryEpoch: number };
type Dependencies = TransactionEngineDependencies<
  { readonly revision: number },
  { readonly kind: "operation" },
  RootMaintenanceControl,
  PersistentRecoveryControl,
  { readonly policyCode: "policy" },
  { readonly outputCode: "output" }
>;

declare const confused: TransactionEngineDependencies<
  { readonly revision: number },
  { readonly kind: "operation" },
  RootMaintenanceControl,
  RootMaintenanceControl,
  { readonly policyCode: "policy" },
  { readonly outputCode: "output" }
>;

createTransactionEngine(confused satisfies Dependencies);
