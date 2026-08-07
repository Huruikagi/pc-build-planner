import {
  type CandidatePartId,
  isUuid,
  PART_CATEGORIES,
  type PartCategory,
  type ProjectId,
  type Result,
} from "../../domain/public.js";
import {
  decodeWithProfile,
  inspectJsonSafety,
  plainObject,
  tagged,
  z,
} from "../../domain/runtime-schema/public.js";
import type { BuildState } from "./state.js";

export interface BuildStateSnapshot {
  readonly version: 1;
  readonly selectedProjectId: ProjectId | null;
  readonly selectedCategory: PartCategory | null;
  readonly quantityDrafts: Readonly<Record<string, string>>;
}

export type BuildSnapshotError =
  | { readonly kind: "invalid-shape" }
  | { readonly kind: "unsupported-version" }
  | { readonly kind: "invalid-reference" };

export interface BuildStateSnapshotCodec {
  capture(state: BuildState): BuildStateSnapshot;
  restore(input: unknown): Result<BuildStateSnapshot, BuildSnapshotError>;
}

const isPartCategory = (value: unknown): value is PartCategory =>
  typeof value === "string" && PART_CATEGORIES.includes(value as PartCategory);

const invalid = <S extends Parameters<typeof tagged>[0]>(schema: S): S =>
  tagged(schema, "invalid-shape");
const quantityDraftsSchema = z.record(
  invalid(z.custom<string>(isUuid)),
  invalid(z.string()),
);
const snapshotSchema = plainObject({
  version: invalid(z.literal(1)),
  selectedProjectId: invalid(
    z.custom<ProjectId | null>((value) => value === null || isUuid(value)),
  ),
  selectedCategory: invalid(
    z.custom<PartCategory | null>(
      (value) => value === null || isPartCategory(value),
    ),
  ),
  quantityDrafts: invalid(quantityDraftsSchema),
});

const hasProjectReference = (state: BuildState, projectId: string): boolean =>
  state.value.projects.some((project) => project.id === projectId);

const hasValidReferences = (
  state: BuildState,
  snapshot: BuildStateSnapshot,
): boolean => {
  if (
    snapshot.selectedProjectId !== null &&
    !hasProjectReference(state, snapshot.selectedProjectId)
  ) {
    return false;
  }
  if (snapshot.selectedProjectId === null)
    return Object.keys(snapshot.quantityDrafts).length === 0;
  const projectId = snapshot.selectedProjectId;
  return Object.keys(snapshot.quantityDrafts).every((candidatePartId) =>
    state.hasCandidateReference(candidatePartId as CandidatePartId, projectId),
  );
};

export const createBuildStateSnapshotCodec = (
  state: BuildState,
): BuildStateSnapshotCodec => ({
  capture(current): BuildStateSnapshot {
    const { selectedProjectId, selectedCategory, quantityDrafts } =
      current.value;
    return { version: 1, selectedProjectId, selectedCategory, quantityDrafts };
  },

  restore(input) {
    if (
      typeof input === "object" &&
      input !== null &&
      "version" in input &&
      input.version !== 1
    )
      return { ok: false, error: { kind: "unsupported-version" } };
    if (!inspectJsonSafety(input).ok)
      return { ok: false, error: { kind: "invalid-shape" } };
    const decoded = decodeWithProfile(snapshotSchema, input, {
      toError: (): BuildSnapshotError => ({ kind: "invalid-shape" }),
    });
    if (!decoded.ok) return decoded;
    const snapshot: BuildStateSnapshot = decoded.value;
    return hasValidReferences(state, snapshot)
      ? { ok: true, value: snapshot }
      : { ok: false, error: { kind: "invalid-reference" } };
  },
});
