import type {
  FoundationError,
  MaintenanceOwnerId,
  Result,
  UtcTimestamp,
} from "../../domain/public.js";
import {
  createUtcTimestamp,
  createUuid,
  err,
  ok,
} from "../../domain/public.js";
import type {
  FoundationDataPort,
  FoundationScopedDataPort,
} from "../../persistence/public.js";
import type {
  BackupArtifact,
  BackupError,
  RestoreError,
  RestoreInput,
  RestoreSummary,
  RestoreTicket,
} from "./contracts.js";
import { BACKUP_PRODUCT_ID, mapFoundationError } from "./contracts.js";
import { exchangeMapper, exchangeMigration } from "./exchange.js";

export interface BackupService {
  create(): Promise<Result<BackupArtifact, BackupError>>;
}

export interface BackupServiceDependencies {
  readonly data: FoundationScopedDataPort;
  readonly now?: () => UtcTimestamp;
}

/** query経路で観測しうるFoundationErrorだけを、値を含まないBackupErrorへ写像する。 */
const mapQueryFailureToBackupError = (error: FoundationError): BackupError => {
  switch (error.code) {
    case "corrupt-data":
    case "migration-failed":
      return { code: "corrupt-current-data" };
    case "unsupported-version":
      return { code: "unsupported-current-data" };
    case "validation":
    case "repair-failed":
    case "revision-conflict":
    case "request-conflict":
    case "maintenance-active":
    case "stale-fence":
    case "stale-assessment":
    case "quota-exceeded":
    case "access-denied":
    case "lock-unavailable":
    case "storage-unavailable":
      return { code: "storage" };
  }
};

const filenameFor = (createdAt: UtcTimestamp): string =>
  `${BACKUP_PRODUCT_ID}-backup-${createdAt.slice(0, 10)}.json`;

export const createBackupService = (
  dependencies: BackupServiceDependencies,
): BackupService => {
  const now = dependencies.now ?? createUtcTimestamp;

  return {
    async create() {
      const snapshot = await dependencies.data.query((root) => root);
      if (!snapshot.ok)
        return err(mapQueryFailureToBackupError(snapshot.error));

      const createdAt = now();
      const envelope = exchangeMapper.fromRoot(snapshot.value, createdAt);

      let json: string;
      try {
        json = JSON.stringify(envelope);
      } catch {
        return err({ code: "serialization" });
      }

      return ok({
        filename: filenameFor(createdAt),
        mimeType: "application/json",
        json,
        byteLength: new TextEncoder().encode(json).byteLength,
      });
    },
  };
};

export interface RestoreService {
  preflight(input: RestoreInput): Promise<Result<RestoreTicket, RestoreError>>;
  commit(ticket: RestoreTicket): Promise<Result<RestoreSummary, RestoreError>>;
}

export interface RestoreServiceDependencies {
  readonly data: FoundationDataPort;
}

/** 保存上限10MBを基準に、JSON解析前に読取前サイズだけで拒否する実装定数。 */
const MAX_RESTORE_INPUT_BYTES = 10 * 1024 * 1024;

/** ExchangeMigration・ExchangeMapperの失敗codeはRestoreErrorCodeの部分集合であり、そのまま写像できる。 */
const exchangeFailureToRestoreError = (error: {
  readonly code: string;
  readonly path: string;
}): RestoreError => ({
  code: error.code as RestoreError["code"],
  path: error.path,
});

/** commit全体はacquire→replaceRoot→release|abortの短い同期区間で完結するため、短いleaseで十分。 */
const MAINTENANCE_LEASE_MS = 30_000;

export const createRestoreService = (
  dependencies: RestoreServiceDependencies,
): RestoreService => ({
  async preflight(input) {
    if (input.byteLength > MAX_RESTORE_INPUT_BYTES)
      return err({ code: "size-exceeded" });

    let parsed: unknown;
    try {
      parsed = JSON.parse(input.text);
    } catch {
      return err({ code: "not-json", path: "$" });
    }

    const migrated = exchangeMigration.toCurrent(parsed);
    if (!migrated.ok) return err(exchangeFailureToRestoreError(migrated.error));
    const envelope = migrated.value;

    const candidate = exchangeMapper.toRoot(envelope);
    if (!candidate.ok)
      return err(exchangeFailureToRestoreError(candidate.error));

    const assessment = await dependencies.data.assessReplacement(
      candidate.value,
    );
    if (!assessment.ok) return err(mapFoundationError(assessment.error));

    return ok({
      candidate: candidate.value,
      assessment: assessment.value,
      preview: {
        createdAt: envelope.createdAt,
        formatVersion: envelope.formatVersion,
        projectCount: envelope.data.projects.length,
        partCount: envelope.data.parts.length,
        currentBuildCount: envelope.data.currentBuilds.length,
        estimatedBytes: assessment.value.requiredBytes,
      },
    });
  },

  async commit(ticket) {
    const ownerId = createUuid() as MaintenanceOwnerId;
    const acquired = await dependencies.data.runMaintenance({
      type: "acquire",
      ownerId,
      leaseMs: MAINTENANCE_LEASE_MS,
    });
    if (!acquired.ok) return err(mapFoundationError(acquired.error));
    const fence = acquired.value.fence;
    if (fence === undefined) return err({ code: "storage-unavailable" });

    const replaced = await dependencies.data.replaceRoot({
      candidate: ticket.candidate,
      assessment: ticket.assessment,
      fence,
    });

    if (!replaced.ok) {
      await dependencies.data.runMaintenance({ type: "abort", fence });
      return err(mapFoundationError(replaced.error));
    }

    await dependencies.data.runMaintenance({ type: "release", fence });
    return ok({
      projectCount: ticket.preview.projectCount,
      partCount: ticket.preview.partCount,
      currentBuildCount: ticket.preview.currentBuildCount,
    });
  },
});
