import type {
  CandidatePart,
  CandidatePartId,
  CurrentBuild,
  CurrentBuildId,
  LocalDataRoot,
  Project,
  ProjectId,
} from "../domain/model.js";
import type { Result } from "../domain/result.js";
import type { SchemaValidator, ValidationError } from "../domain/validation.js";
import type {
  ReferenceRepairPolicy,
  RepairError,
  RootChange,
} from "./reference-repair-policy.js";

const DEFAULT_WARNING_RATIO = 0.8;
const STORAGE_KEY = "localDataRoot";

export interface CapacityInput {
  readonly currentBytes: number;
  readonly quotaBytes: number;
}

export interface MutationCapacityStatus {
  readonly beforeBytes: number;
  readonly afterBytes: number;
  readonly requiredBytes: number;
  readonly quotaBytes: number;
  readonly warningThresholdBytes: number;
  readonly warnings: readonly {
    readonly code: "capacity-warning";
    readonly thresholdBytes: number;
  }[];
}

type EntityOperation<Entity extends string, Value, Id> =
  | { readonly kind: "create"; readonly entity: Entity; readonly value: Value }
  | { readonly kind: "update"; readonly entity: Entity; readonly value: Value }
  | { readonly kind: "delete"; readonly entity: Entity; readonly id: Id };

export type RootOperation =
  | EntityOperation<"project", Project, ProjectId>
  | EntityOperation<"candidatePart", CandidatePart, CandidatePartId>
  | EntityOperation<"currentBuild", CurrentBuild, CurrentBuildId>;

export type MutationPipelineError =
  | { readonly code: "entity-already-exists" }
  | { readonly code: "entity-not-found" }
  | { readonly code: "invalid-capacity-input" }
  | { readonly code: "quota-exceeded" }
  | { readonly code: "validation"; readonly issue: ValidationError }
  | RepairError;

export interface MutationCandidate {
  readonly root: LocalDataRoot;
  readonly capacity: MutationCapacityStatus;
}

export interface MutationPipeline {
  apply(
    snapshot: LocalDataRoot,
    operation: RootOperation,
    capacity: CapacityInput,
  ): Result<MutationCandidate, MutationPipelineError>;
}

type CollectionKey = "projects" | "candidateParts" | "currentBuilds";
type RootEntity = Project | CandidatePart | CurrentBuild;

const collectionFor = (entity: RootOperation["entity"]): CollectionKey => {
  switch (entity) {
    case "project":
      return "projects";
    case "candidatePart":
      return "candidateParts";
    case "currentBuild":
      return "currentBuilds";
  }
};

const applyCrud = (
  snapshot: LocalDataRoot,
  operation: RootOperation,
): Result<LocalDataRoot, MutationPipelineError> => {
  const key = collectionFor(operation.entity);
  const values: readonly RootEntity[] = snapshot[key];
  const id = operation.kind === "delete" ? operation.id : operation.value.id;
  const index = values.findIndex((value) => value.id === id);
  if (operation.kind === "create") {
    if (index >= 0)
      return { ok: false, error: { code: "entity-already-exists" } };
    return {
      ok: true,
      value: { ...snapshot, [key]: [...values, operation.value] },
    };
  }
  if (index < 0) return { ok: false, error: { code: "entity-not-found" } };
  const next =
    operation.kind === "delete"
      ? values.filter((_, itemIndex) => itemIndex !== index)
      : values.map((value, itemIndex) =>
          itemIndex === index ? operation.value : value,
        );
  return { ok: true, value: { ...snapshot, [key]: next } };
};

const rootChangeFor = (
  snapshot: LocalDataRoot,
  operation: RootOperation,
): RootChange => {
  if (operation.entity === "project" && operation.kind === "delete")
    return { kind: "project-deleted", projectId: operation.id };
  if (operation.entity !== "candidatePart") return { kind: "unrelated" };
  if (operation.kind === "delete")
    return { kind: "candidate-deleted", candidatePartId: operation.id };
  if (operation.kind === "update") {
    const previous = snapshot.candidateParts.find(
      (candidate) => candidate.id === operation.value.id,
    );
    if (previous && previous.category !== operation.value.category)
      return {
        kind: "candidate-category-changed",
        candidatePartId: operation.value.id,
      };
  }
  return { kind: "unrelated" };
};

const requiredBytes = (root: LocalDataRoot): number =>
  new TextEncoder().encode(JSON.stringify({ [STORAGE_KEY]: root })).byteLength;

const assessCapacity = (
  root: LocalDataRoot,
  input: CapacityInput,
  warningRatio: number,
): Result<MutationCapacityStatus, MutationPipelineError> => {
  if (
    !Number.isSafeInteger(input.currentBytes) ||
    input.currentBytes < 0 ||
    !Number.isSafeInteger(input.quotaBytes) ||
    input.quotaBytes < 0
  )
    return { ok: false, error: { code: "invalid-capacity-input" } };
  const afterBytes = requiredBytes(root);
  if (afterBytes > input.quotaBytes)
    return { ok: false, error: { code: "quota-exceeded" } };
  const warningThresholdBytes = input.quotaBytes * warningRatio;
  return {
    ok: true,
    value: {
      beforeBytes: input.currentBytes,
      afterBytes,
      requiredBytes: afterBytes,
      quotaBytes: input.quotaBytes,
      warningThresholdBytes,
      warnings:
        afterBytes >= warningThresholdBytes
          ? [
              {
                code: "capacity-warning",
                thresholdBytes: warningThresholdBytes,
              },
            ]
          : [],
    },
  };
};

export const createMutationPipeline = (
  validator: SchemaValidator,
  repairPolicy: ReferenceRepairPolicy,
  warningRatio = DEFAULT_WARNING_RATIO,
): MutationPipeline => {
  if (!Number.isFinite(warningRatio) || warningRatio <= 0 || warningRatio > 1)
    throw new RangeError("warningRatio must be greater than 0 and at most 1");
  return {
    apply(snapshot, operation, capacityInput) {
      const applied = applyCrud(snapshot, operation);
      if (!applied.ok) return applied;
      const repaired = repairPolicy.repair(
        snapshot,
        applied.value,
        rootChangeFor(snapshot, operation),
      );
      if (!repaired.ok) return repaired;
      const validated = validator.validateRoot(repaired.value);
      if (!validated.ok)
        return {
          ok: false,
          error: { code: "validation", issue: validated.error },
        };
      const capacity = assessCapacity(
        validated.value,
        capacityInput,
        warningRatio,
      );
      return capacity.ok
        ? {
            ok: true,
            value: { root: validated.value, capacity: capacity.value },
          }
        : capacity;
    },
  };
};
