import type { BackupOrchestrator } from "@pc-build-planner/local-data/backup";

import type { FoundationError } from "../../src/domain/public.js";
import type {
  BackupArtifact,
  RestoreInput,
  RestorePreview,
  RestoreSummary,
} from "../../src/features/backup-restore/contracts.js";

declare const backup: BackupOrchestrator<
  RestoreInput,
  BackupArtifact,
  RestorePreview,
  RestoreSummary,
  FoundationError
>;

backup.query;
backup.mutate;
backup.execute;
backup.readRoot;
backup.writeRoot;
backup.storage;
backup.lock;
backup.fence;
