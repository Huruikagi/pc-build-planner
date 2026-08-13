import type {
  LocalDataPolicy,
  PersistentControlPolicy,
  RequestRecord,
} from "@pc-build-planner/local-data";
import type { ChromeStorageKeyScope } from "@pc-build-planner/local-data/chrome";
import type { Revision } from "../domain/identifiers.js";
import type {
  LocalDataRoot,
  MaintenanceState,
  RequestDedupeRecord,
} from "../domain/model.js";
import type { FoundationError } from "../domain/result.js";
import { schemaValidator } from "../domain/validation.js";
import { createMigrationRegistry } from "./migration-registry.js";
import type { RootOperation } from "./mutation-pipeline.js";
import { validateRecoveryControl } from "./recovery-control.js";
import {
  type RootChange,
  referenceRepairPolicy,
} from "./reference-repair-policy.js";
import {
  CURRENT_SCHEMA_VERSION,
  createInitialRoot,
  LOCAL_DATA_STORAGE_KEY,
  RECOVERY_CONTROL_STORAGE_KEY,
  REQUEST_DEDUPE_LIMIT,
} from "./schema.js";

export type ProductLocalDataPolicy = LocalDataPolicy<
  LocalDataRoot,
  RootOperation,
  MaintenanceState,
  FoundationError
>;

const migrationRegistry = createMigrationRegistry(
  CURRENT_SCHEMA_VERSION,
  [],
  schemaValidator,
);

const collectionFor = (entity: RootOperation["entity"]) => {
  switch (entity) {
    case "project":
      return "projects" as const;
    case "candidatePart":
      return "candidateParts" as const;
    case "currentBuild":
      return "currentBuilds" as const;
  }
};

const applyOperation = (
  root: LocalDataRoot,
  operation: RootOperation,
): ReturnType<ProductLocalDataPolicy["apply"]> => {
  const key = collectionFor(operation.entity);
  const values = root[key] as readonly { readonly id: string }[];
  const id = operation.kind === "delete" ? operation.id : operation.value.id;
  const index = values.findIndex((value) => value.id === id);
  if (operation.kind === "create" && index >= 0)
    return {
      ok: false,
      error: { code: "validation", reason: "entity-already-exists" },
    };
  if (operation.kind !== "create" && index < 0)
    return {
      ok: false,
      error: { code: "validation", reason: "entity-not-found" },
    };
  const next =
    operation.kind === "create"
      ? [...values, operation.value]
      : operation.kind === "delete"
        ? values.filter((_, itemIndex) => itemIndex !== index)
        : values.map((value, itemIndex) =>
            itemIndex === index ? operation.value : value,
          );
  return { ok: true, value: { ...root, [key]: next } as LocalDataRoot };
};

const repairChange = (
  before: LocalDataRoot,
  proposed: LocalDataRoot,
): RootChange => {
  const deletedProject = before.projects.find(
    (project) => !proposed.projects.some((item) => item.id === project.id),
  );
  if (deletedProject)
    return { kind: "project-deleted", projectId: deletedProject.id };
  const deletedCandidate = before.candidateParts.find(
    (candidate) =>
      !proposed.candidateParts.some((item) => item.id === candidate.id),
  );
  if (deletedCandidate)
    return { kind: "candidate-deleted", candidatePartId: deletedCandidate.id };
  const changedCandidate = before.candidateParts.find((candidate) => {
    const next = proposed.candidateParts.find(
      (item) => item.id === candidate.id,
    );
    return next !== undefined && next.category !== candidate.category;
  });
  return changedCandidate
    ? {
        kind: "candidate-category-changed",
        candidatePartId: changedCandidate.id,
      }
    : { kind: "unrelated" };
};

const migrationFailure = (): FoundationError => ({ code: "migration-failed" });

export const productLocalDataPolicy: ProductLocalDataPolicy = {
  decodeAndMigrate(input) {
    const migrated = migrationRegistry.toCurrent(input);
    if (migrated.ok) return migrated;
    if (migrated.error.code === "unsupported-version")
      return { ok: false, error: { code: "unsupported-version" } };
    if (migrated.error.code === "validation")
      return { ok: false, error: { code: "validation" } };
    return { ok: false, error: migrationFailure() };
  },
  apply: applyOperation,
  repair(root, previous) {
    const repaired = referenceRepairPolicy.repair(
      previous,
      root,
      repairChange(previous, root),
    );
    return repaired.ok ? repaired : { ok: false, error: repaired.error };
  },
  revision: (root) => root.revision,
  withRevision: (root, revision) => ({
    ...root,
    revision: revision as Revision,
  }),
  requestRecord(root, requestId) {
    const record = root.requestDedupe.find(
      (item) => item.requestId === requestId,
    );
    return record === undefined
      ? undefined
      : {
          requestId,
          digest: record.payloadDigest,
          revision: record.committedRevision,
        };
  },
  withRequestRecord(root, record: RequestRecord) {
    const productRecord: RequestDedupeRecord = {
      requestId: record.requestId as RequestDedupeRecord["requestId"],
      payloadDigest: record.digest,
      committedRevision: record.revision as Revision,
    };
    return {
      ...root,
      requestDedupe: [...root.requestDedupe, productRecord].slice(
        -REQUEST_DEDUPE_LIMIT,
      ),
    };
  },
  control: (root) => root.maintenance,
  withControl: (root, control) => ({ ...root, maintenance: control }),
};

export const productLocalDataStorageScope: ChromeStorageKeyScope = {
  root: LOCAL_DATA_STORAGE_KEY,
  control: RECOVERY_CONTROL_STORAGE_KEY,
};

export const productWorkerPolicy: PersistentControlPolicy = {
  authorizeMutation(control) {
    const validated = validateRecoveryControl(control);
    if (!validated.ok) return { ok: false, error: { code: "stale-fence" } };
    return validated.value.active
      ? { ok: false, error: { code: "recovery-active" } }
      : { ok: true, value: undefined };
  },
};

export const productLocalDataAdapter = {
  createInitialRoot,
  schemaVersion: CURRENT_SCHEMA_VERSION,
  policy: productLocalDataPolicy,
  storageScope: productLocalDataStorageScope,
  workerPolicy: productWorkerPolicy,
} as const;
