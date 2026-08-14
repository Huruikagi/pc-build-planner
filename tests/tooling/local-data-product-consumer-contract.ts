import type { AppDataError, Result } from "../../src/domain/public.js";
import type {
  BackupRestoreDataPort,
  FoundationScopedDataPort,
} from "../../src/persistence/public.js";

type DataOperationResult<Value> = Result<Value, AppDataError>;

export const candidateManagementConsumer = <Value>(
  result: DataOperationResult<Value>,
) => result;

export const currentBuildConsumer = <Value>(
  result: DataOperationResult<Value>,
) => result;

export const compatibilityConsumer = <Value>(
  result: DataOperationResult<Value>,
) => result;

export const candidateSourceConsumer = <Value>(
  result: DataOperationResult<Value>,
) => result;

export const sourcePriceRefreshConsumer = <Value>(
  result: DataOperationResult<Value>,
) => result;

export const consumeNormalData = (
  data: FoundationScopedDataPort,
): FoundationScopedDataPort["query"] => data.query;

export const consumeBackupData = (
  backup: BackupRestoreDataPort,
): BackupRestoreDataPort["commit"] => backup.commit;
