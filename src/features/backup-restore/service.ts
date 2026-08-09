import type {
  FoundationError,
  Result,
  UtcTimestamp,
} from "../../domain/public.js";
import { createUtcTimestamp, err, ok } from "../../domain/public.js";
import type {
  BackupRestoreDataPort,
  FoundationScopedDataPort,
} from "../../persistence/public.js";
import {
  type RestoreFileCapacityPolicy,
  restoreFileCapacityPolicy,
} from "./capacity-policy.js";
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
  readonly capacityPolicy?: RestoreFileCapacityPolicy;
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
    case "recovery-active":
    case "stale-fence":
    case "stale-assessment":
    case "stale-recovery-state":
    case "precommit-cleanup-pending":
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
  const capacityPolicy =
    dependencies.capacityPolicy ?? restoreFileCapacityPolicy;

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

      const artifact = {
        filename: filenameFor(createdAt),
        mimeType: "application/json" as const,
        json,
        byteLength: new TextEncoder().encode(json).byteLength,
      };
      const capacity = capacityPolicy.assertExportRestorable(
        artifact.byteLength,
      );
      if (!capacity.ok) return err({ code: "backup-capacity-invariant" });
      return ok(artifact);
    },
  };
};

export interface RestoreService {
  preflight(input: RestoreInput): Promise<Result<RestoreTicket, RestoreError>>;
  commit(ticket: RestoreTicket): Promise<Result<RestoreSummary, RestoreError>>;
}

export interface RestoreServiceDependencies {
  readonly data: BackupRestoreDataPort;
}

/** ExchangeMigration・ExchangeMapperの失敗codeはRestoreErrorCodeの部分集合であり、そのまま写像できる。 */
const exchangeFailureToRestoreError = (error: {
  readonly code: string;
  readonly path: string;
}): RestoreError => ({
  code: error.code as RestoreError["code"],
  path: error.path,
});

export const createRestoreService = (
  dependencies: RestoreServiceDependencies,
): RestoreService => ({
  async preflight(input) {
    if (!restoreFileCapacityPolicy.accepts(input.byteLength))
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
      assessment: assessment.value.ticket,
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
    if (ticket.assessment === undefined) return err({ code: "stale-ticket" });
    const committed = await dependencies.data.commit({
      candidate: ticket.candidate,
      assessment: ticket.assessment,
      expectedMode: "normal",
    });
    if (!committed.ok) return err(mapFoundationError(committed.error));
    return ok({
      projectCount: ticket.preview.projectCount,
      partCount: ticket.preview.partCount,
      currentBuildCount: ticket.preview.currentBuildCount,
    });
  },
});
