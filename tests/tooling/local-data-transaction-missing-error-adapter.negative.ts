import {
  createTransactionEngine,
  type TransactionEngineDependencies,
} from "@pc-build-planner/local-data";

type Dependencies = TransactionEngineDependencies<
  { readonly revision: number },
  { readonly kind: "operation" },
  { readonly maintenanceToken: string },
  { readonly recoveryEpoch: number },
  { readonly policyCode: "policy" },
  { readonly outputCode: "output" }
>;

declare const dependenciesWithoutErrors: Omit<Dependencies, "errors">;
createTransactionEngine(dependenciesWithoutErrors);
