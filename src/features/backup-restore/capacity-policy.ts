import type { Result } from "../../domain/public.js";
import { err, ok } from "../../domain/public.js";
import { MAX_RESTORE_INPUT_BYTES } from "./contracts.js";

/** Foundationが`localDataRoot`一件に適用する保存上限。入力ファイル上限とは別契約。 */
export const FOUNDATION_ROOT_CAPACITY_BYTES = 10 * 1024 * 1024;

/**
 * Mapper差分の監査表。保存される可変値は一度だけ交換形式へ写されるため、10 MiB
 * の保存rootにこの固定JSON構造差分を加えれば、artifactのUTF-8上界を得られる。
 */
export const EXCHANGE_FIELD_DIFFS = [
  { entity: "root", persisted: "schemaVersion", exchange: null },
  { entity: "root", persisted: "revision", exchange: null },
  { entity: "root", persisted: "candidateParts", exchange: "data.parts" },
  { entity: "root", persisted: "requestDedupe", exchange: null },
  { entity: "root", persisted: "maintenance", exchange: null },
  { entity: "envelope", persisted: null, exchange: "product" },
  { entity: "envelope", persisted: null, exchange: "formatVersion" },
  { entity: "envelope", persisted: null, exchange: "createdAt" },
] as const;

// `{"localDataRoot":` is replaced by the envelope's fixed header and `data` wrapper.
// This deliberately over-allocates fixed punctuation, the product id, a timestamp and
// numeric fields; no user-controlled value is counted here because Mapper copies it once.
const ENVELOPE_FIXED_OVERHEAD_BYTES = 512;

export const MAX_RESTORABLE_EXPORT_BYTES =
  FOUNDATION_ROOT_CAPACITY_BYTES + ENVELOPE_FIXED_OVERHEAD_BYTES;

export interface RestoreFileCapacityPolicy {
  readonly maxInputBytes: typeof MAX_RESTORE_INPUT_BYTES;
  accepts(byteLength: number): boolean;
  assertExportRestorable(
    artifactByteLength: number,
  ): Result<void, { readonly kind: "backup-capacity-invariant" }>;
}

export const restoreFileCapacityPolicy: RestoreFileCapacityPolicy = {
  maxInputBytes: MAX_RESTORE_INPUT_BYTES,
  accepts(byteLength) {
    return (
      Number.isSafeInteger(byteLength) &&
      byteLength >= 0 &&
      byteLength <= MAX_RESTORE_INPUT_BYTES
    );
  },
  assertExportRestorable(artifactByteLength) {
    return this.accepts(artifactByteLength)
      ? ok(undefined)
      : err({ kind: "backup-capacity-invariant" });
  },
};
