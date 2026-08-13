import {
  type CapacityPolicy,
  createTransactionEngine,
  type ErrorAdapter,
  type ExclusiveLockPort,
  type FencingPolicy,
  type LocalDataPolicy,
  type TransactionStoragePort,
} from "@pc-build-planner/local-data";

type RootMaintenanceControl = Readonly<{ maintenanceToken: string }>;
type PersistentRecoveryControl = Readonly<{ recoveryEpoch: number }>;
type PolicyError = Readonly<{
  policyCode: "synthetic-policy";
  payload: { field: string };
}>;
type OutputError = Readonly<{
  outputCode: "synthetic-output";
  source: PolicyError;
}>;
type Root = Readonly<{
  revision: number;
  value: string;
  maintenance: RootMaintenanceControl;
}>;
type Operation = Readonly<{ value: string }>;

declare const storage: TransactionStoragePort<Root, PersistentRecoveryControl>;
declare const lock: ExclusiveLockPort;
declare const policy: LocalDataPolicy<
  Root,
  Operation,
  RootMaintenanceControl,
  PolicyError
>;
declare const errors: ErrorAdapter<PolicyError, OutputError>;
declare const capacity: CapacityPolicy<Root>;
declare const fencing: FencingPolicy<Root>;

const transaction = createTransactionEngine({
  storage,
  lock,
  policy,
  errors,
  capacity,
  fencing,
  recovery: {
    authorizeMutation(control: PersistentRecoveryControl | undefined) {
      return control === undefined || control.recoveryEpoch >= 0
        ? { ok: true, value: undefined }
        : {
            ok: false,
            error: {
              outputCode: "synthetic-output",
              source: {
                policyCode: "synthetic-policy",
                payload: { field: "recoveryEpoch" },
              },
            },
          };
    },
  },
  digest: (operation: Operation) => operation.value,
  now: () => 1,
});

void transaction;
