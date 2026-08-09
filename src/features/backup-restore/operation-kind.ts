import type { OperationKind } from "../../application-shell/public.js";

export const backupExportOperation = "mutation" satisfies OperationKind;
export const backupRestoreRecoveryOperation =
  "recovery" satisfies OperationKind;
