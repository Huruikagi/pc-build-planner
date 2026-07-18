import type { LocalDataRoot } from "../domain/model.js";
import type { FoundationError, Result } from "../domain/result.js";

export type StorageError = Extract<
  FoundationError,
  { readonly code: "access-denied" | "quota-exceeded" | "storage-unavailable" }
>;

/** Platform APIをdomain persistenceから隔離する単一root保存port。 */
export interface StoragePort {
  readRoot(): Promise<Result<unknown | undefined, StorageError>>;
  writeRoot(root: LocalDataRoot): Promise<Result<void, StorageError>>;
  bytesInUse(): Promise<Result<number, StorageError>>;
  quotaBytes(): number;
  restrictToTrustedContexts(): Promise<Result<void, StorageError>>;
}
