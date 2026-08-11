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

/**
 * `project-mismatch` は破損ではなく「古い画面状態を今の現在projectへ適用できない」
 * ことを表す。復元は行わず、現在projectも永続データも変更しない（要件 8.4）。
 */
export type BuildSnapshotError =
  | { readonly kind: "invalid-shape" }
  | { readonly kind: "unsupported-version" }
  | { readonly kind: "invalid-reference" }
  | { readonly kind: "project-mismatch" };

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

/**
 * 現在projectは常にfeature stateの射影から読む。snapshotは候補にならない。
 * `empty` と `unavailable` では state 側が selectedProjectId を解放済みなので、
 * 照合対象の現在projectはそのまま null になる。
 */
const currentProjectId = (state: BuildState): ProjectId | null =>
  state.value.selectedProjectId;

const rejectionFor = (
  state: BuildState,
  snapshot: BuildStateSnapshot,
): BuildSnapshotError | null => {
  if (snapshot.selectedProjectId === null)
    return Object.keys(snapshot.quantityDrafts).length === 0
      ? null
      : { kind: "invalid-reference" };
  const current = currentProjectId(state);
  // snapshotのproject IDは一致検査にだけ使い、選択authorityにはしない。
  if (current === null || current !== snapshot.selectedProjectId)
    return { kind: "project-mismatch" };
  return Object.keys(snapshot.quantityDrafts).every((candidatePartId) =>
    state.hasCandidateReference(candidatePartId as CandidatePartId, current),
  )
    ? null
    : { kind: "invalid-reference" };
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
    const rejection = rejectionFor(state, snapshot);
    return rejection === null
      ? { ok: true, value: snapshot }
      : { ok: false, error: rejection };
  },
});
