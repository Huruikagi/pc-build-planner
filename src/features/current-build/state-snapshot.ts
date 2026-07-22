import {
  type CandidatePartId,
  isUuid,
  PART_CATEGORIES,
  type PartCategory,
  type ProjectId,
  type Result,
} from "../../domain/public.js";
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null) &&
  Object.getOwnPropertySymbols(value).every(
    (symbol) => !Object.prototype.propertyIsEnumerable.call(value, symbol),
  );

const hasOnlyKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean =>
  Object.keys(value).every((key) => keys.includes(key)) &&
  keys.every((key) => key in value);

const isPartCategory = (value: unknown): value is PartCategory =>
  typeof value === "string" && PART_CATEGORIES.includes(value as PartCategory);

const isSafeString = (value: unknown): value is string =>
  typeof value === "string" &&
  !/^data:/i.test(value) &&
  !/<(?:!doctype\s+html|!--|\/?[a-z][^>]*>)/i.test(value);

const isQuantityDrafts = (
  value: unknown,
): value is Readonly<Record<string, string>> =>
  isRecord(value) &&
  Object.entries(value).every(
    ([key, draft]) => isUuid(key) && isSafeString(draft),
  );

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
    if (!isRecord(input))
      return { ok: false, error: { kind: "invalid-shape" } };
    if (input.version !== 1) {
      return { ok: false, error: { kind: "unsupported-version" } };
    }
    if (
      !hasOnlyKeys(input, [
        "version",
        "selectedProjectId",
        "selectedCategory",
        "quantityDrafts",
      ]) ||
      (input.selectedProjectId !== null &&
        typeof input.selectedProjectId !== "string") ||
      (input.selectedCategory !== null &&
        !isPartCategory(input.selectedCategory)) ||
      !isQuantityDrafts(input.quantityDrafts)
    ) {
      return { ok: false, error: { kind: "invalid-shape" } };
    }

    const snapshot: BuildStateSnapshot = {
      version: 1,
      selectedProjectId: input.selectedProjectId as ProjectId | null,
      selectedCategory: input.selectedCategory as PartCategory | null,
      quantityDrafts: input.quantityDrafts,
    };
    return hasValidReferences(state, snapshot)
      ? { ok: true, value: snapshot }
      : { ok: false, error: { kind: "invalid-reference" } };
  },
});
