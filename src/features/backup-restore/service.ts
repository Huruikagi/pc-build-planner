import type {
  FoundationError,
  Result,
  UtcTimestamp,
} from "../../domain/public.js";
import { createUtcTimestamp, err, ok } from "../../domain/public.js";
import type {
  BackupRestoreDataPort,
  BackupRestoreFinalizationTicket,
} from "../../persistence/public.js";
import {
  type RestoreFileCapacityPolicy,
  restoreFileCapacityPolicy,
} from "./capacity-policy.js";
import type {
  BackupArtifact,
  BackupError,
  BackupSnapshotReadPort,
  RestoreCommitOutcome,
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
  readonly data: BackupSnapshotReadPort;
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
  reassess?(
    ticket: RestoreTicket,
  ): Promise<Result<RestoreTicket, RestoreError>>;
  commit(
    ticket: RestoreTicket,
  ): Promise<Result<RestoreCommitOutcome | RestoreSummary, RestoreError>>;
  /** summaryを失った再mount経路では、finalize成功後に検証済みsnapshotから件数を再構築する。 */
  finalize?(
    ticket: BackupRestoreFinalizationTicket,
    summary: RestoreSummary | undefined,
  ): Promise<Result<RestoreSummary, RestoreError>>;
  findPendingFinalization?(): Promise<
    Result<BackupRestoreFinalizationTicket | null, RestoreError>
  >;
}

export interface RestoreServiceDependencies {
  readonly data: BackupRestoreDataPort;
  /** finalize後の件数再構築だけに使う読取専用snapshot。通常CRUDは受け取らない。 */
  readonly snapshot?: BackupSnapshotReadPort;
}

/** ExchangeMigration・ExchangeMapperの失敗codeはRestoreErrorCodeの部分集合であり、そのまま写像できる。 */
const exchangeFailureToRestoreError = (error: {
  readonly code: string;
  readonly path: string;
}): RestoreError => ({
  code: error.code as RestoreError["code"],
  path: error.path,
});

const assessmentFailureToRestoreError = (error: {
  readonly code: string;
}): RestoreError =>
  error.code === "recovery-candidate-rejected"
    ? { code: "invalid-structure" }
    : mapFoundationError(error as FoundationError);

export const createRestoreService = (
  dependencies: RestoreServiceDependencies,
): RestoreService => {
  const assess = async (
    candidate: unknown,
    preview: Omit<RestoreTicket["preview"], "estimatedBytes">,
  ): Promise<Result<RestoreTicket, RestoreError>> => {
    const normal = await dependencies.data.assessReplacement(candidate);
    const assessment =
      !normal.ok &&
      (normal.error.code === "corrupt-data" ||
        normal.error.code === "unsupported-version")
        ? await dependencies.data.assessRecovery(candidate)
        : normal;
    if (!assessment.ok)
      return err(assessmentFailureToRestoreError(assessment.error));
    return ok({
      candidate,
      mode: assessment.value.mode,
      assessment: assessment.value.ticket,
      ...(assessment.value.currentAnomaly === undefined
        ? {}
        : { currentAnomaly: { code: assessment.value.currentAnomaly.code } }),
      preview: { ...preview, estimatedBytes: assessment.value.requiredBytes },
    });
  };

  return {
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
      if (!migrated.ok)
        return err(exchangeFailureToRestoreError(migrated.error));
      const envelope = migrated.value;

      const candidate = exchangeMapper.toRoot(envelope);
      if (!candidate.ok)
        return err(exchangeFailureToRestoreError(candidate.error));

      return assess(candidate.value, {
        createdAt: envelope.createdAt,
        formatVersion: envelope.formatVersion,
        projectCount: envelope.data.projects.length,
        partCount: envelope.data.parts.length,
        currentBuildCount: envelope.data.currentBuilds.length,
      });
    },

    async reassess(ticket) {
      return assess(ticket.candidate, {
        createdAt: ticket.preview.createdAt,
        formatVersion: ticket.preview.formatVersion,
        projectCount: ticket.preview.projectCount,
        partCount: ticket.preview.partCount,
        currentBuildCount: ticket.preview.currentBuildCount,
      });
    },

    async commit(ticket) {
      if (ticket.assessment === undefined || ticket.mode === undefined)
        return err({ code: "stale-ticket" });
      const committed = await dependencies.data.commit({
        candidate: ticket.candidate,
        assessment: ticket.assessment,
        expectedMode: ticket.mode,
      });
      if (!committed.ok) return err(mapFoundationError(committed.error));
      const summary = {
        projectCount: ticket.preview.projectCount,
        partCount: ticket.preview.partCount,
        currentBuildCount: ticket.preview.currentBuildCount,
      };
      return ok(
        committed.value.kind === "committed"
          ? { kind: "committed", summary }
          : {
              kind: "committed-finalization-required",
              summary,
              finalization: committed.value.finalization,
            },
      );
    },

    async finalize(ticket, summary) {
      const finalized = await dependencies.data.finalize(ticket);
      if (!finalized.ok) return err(mapFoundationError(finalized.error));
      if (summary !== undefined) return ok(summary);

      /** 再mountでsummaryを失った場合だけ、root writeなしで件数を読み直す。 */
      const snapshot = dependencies.snapshot;
      if (snapshot === undefined) return err({ code: "storage-unavailable" });
      const counts = await snapshot.query((root) => ({
        projectCount: root.projects.length,
        partCount: root.candidateParts.length,
        currentBuildCount: root.currentBuilds.length,
      }));
      if (!counts.ok) return err(mapFoundationError(counts.error));
      return ok(counts.value);
    },

    async findPendingFinalization() {
      const pending = await dependencies.data.findPendingFinalization();
      return pending.ok ? pending : err(mapFoundationError(pending.error));
    },
  };
};
