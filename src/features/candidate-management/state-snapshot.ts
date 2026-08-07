import {
  PART_CATEGORIES,
  type PartCategory,
  type ProjectId,
  type Result,
} from "../../domain/public.js";
import {
  decodeWithProfile,
  httpUrl,
  inspectJsonSafety,
  optionalField,
  plainObject,
  safeString,
  tagged,
  utcTimestamp,
  uuid,
  z,
} from "../../domain/runtime-schema/public.js";
import type { CandidateDraft } from "./contracts.js";
import type {
  DuplicateDecisionState,
  DuplicateMergeStateSnapshot,
  DuplicateMergeStateSnapshotCodec,
} from "./duplicate-merge-state.js";
import type {
  CandidateEditor,
  DeletionConfirmation,
  ManagementDisplayError,
  ManagementState,
} from "./state.js";

export interface ManagementStateSnapshot {
  readonly version: 3;
  readonly selectedProjectId: ProjectId | null;
  readonly selectedCategory: PartCategory | null;
  readonly editor: CandidateEditor | null;
  readonly deletion: DeletionConfirmation | null;
  readonly displayError: ManagementDisplayError | null;
  readonly duplicateDecision: DuplicateMergeStateSnapshot | null;
}

export interface RestoredManagementStateSnapshot
  extends Omit<ManagementStateSnapshot, "duplicateDecision"> {
  readonly duplicateDecision: DuplicateDecisionState;
}

export type ManagementSnapshotError =
  | { readonly kind: "invalid-shape" }
  | { readonly kind: "unsupported-version" }
  | { readonly kind: "invalid-reference" }
  | { readonly kind: "invalid-draft" };

export interface ManagementStateSnapshotCodec {
  capture(state: ManagementState): ManagementStateSnapshot;
  restore(
    input: unknown,
  ): Result<RestoredManagementStateSnapshot, ManagementSnapshotError>;
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

const isPartCategory = (value: unknown): value is PartCategory =>
  typeof value === "string" && PART_CATEGORIES.includes(value as PartCategory);

const schemaAccepts = (
  schema: Parameters<typeof z.safeParse>[0],
  value: unknown,
) => z.safeParse(schema, value).success;

const nullableStringSchema = z.custom<string | null>(
  (value) => value === null || typeof value === "string",
);
const finiteNumberSchema = z.custom<number>(
  (value) => typeof value === "number" && Number.isFinite(value),
);
const sourcedStringSchema = plainObject({
  original: nullableStringSchema,
  confirmed: optionalField(safeString()),
});
const sourcedStringsSchema = plainObject({
  original: nullableStringSchema,
  confirmed: optionalField(z.array(safeString())),
});
const moneySchema = plainObject({
  amount: finiteNumberSchema,
  currency: safeString(),
});
const sourcedMoneySchema = plainObject({
  original: nullableStringSchema,
  confirmed: optionalField(moneySchema),
});

export const isSourcedValueSnapshot = (
  value: unknown,
  confirmed: "string" | "strings" | "money" = "string",
): value is {
  readonly original: string | null;
  readonly confirmed?: unknown;
} =>
  schemaAccepts(
    confirmed === "string"
      ? sourcedStringSchema
      : confirmed === "strings"
        ? sourcedStringsSchema
        : sourcedMoneySchema,
    value,
  );

const productSchema = plainObject({
  name: optionalField(sourcedStringSchema),
  manufacturer: optionalField(sourcedStringSchema),
  modelNumber: optionalField(sourcedStringSchema),
  notes: optionalField(sourcedStringSchema),
});

const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

const candidateSourceSchema = plainObject({
  id: uuid(),
  pageUrl: optionalField(httpUrl()),
  siteName: optionalField(safeString()),
  capturedAt: optionalField(utcTimestamp()),
  price: optionalField(sourcedMoneySchema),
  kind: optionalField(
    z.custom<"retail" | "manufacturer">(
      (value) => value === "retail" || value === "manufacturer",
    ),
  ),
});

export const isCandidateSourceSnapshot = (value: unknown): boolean =>
  schemaAccepts(candidateSourceSchema, value);

const isSourceState = (value: Record<string, unknown>): boolean => {
  if (
    !Array.isArray(value.sources) ||
    !value.sources.every(isCandidateSourceSnapshot)
  )
    return false;
  const ids = value.sources.map((source) => (source as { id: string }).id);
  if (new Set(ids).size !== ids.length) return false;
  return value.sources.length === 0
    ? !("primarySourceId" in value) || value.primarySourceId === undefined
    : isUuid(value.primarySourceId) && ids.includes(value.primarySourceId);
};

const sourceSnapshotSchema = z.record(
  safeString(),
  z.custom<string | null>(
    (value) => value === null || typeof value === "string",
  ),
);

const attributeKinds: Readonly<
  Record<PartCategory, Readonly<Record<string, "string" | "strings">>>
> = {
  cpu: { socket: "string" },
  "cpu-cooler": { supportedSockets: "strings" },
  motherboard: {
    socket: "string",
    memoryStandard: "string",
    formFactor: "string",
  },
  memory: { memoryStandard: "string" },
  gpu: {},
  storage: {},
  "power-supply": { formFactor: "string" },
  case: {
    supportedMotherboardFormFactors: "strings",
    supportedPowerSupplyFormFactors: "strings",
  },
  "case-fan": {},
  "expansion-card": {},
  other: {},
  uncategorized: {},
};

const isAttributes = (value: unknown, category: PartCategory): boolean => {
  if (!isRecord(value) || value.category !== category) return false;
  const fields = attributeKinds[category];
  return (
    Object.keys(value).every((key) => key === "category" || key in fields) &&
    Object.entries(fields).every(
      ([key, kind]) =>
        !(key in value) || isSourcedValueSnapshot(value[key], kind),
    )
  );
};

/** Shared fail-closed validator for feature-local UI snapshots. */
const candidateDraftShapeSchema = plainObject({
  projectId: uuid<ProjectId>(),
  category: z.custom<PartCategory>(isPartCategory),
  product: productSchema,
  normalizedAttributes: z.unknown(),
  sources: z.array(candidateSourceSchema),
  primarySourceId: optionalField(uuid()),
  sourceSnapshot: optionalField(sourceSnapshotSchema),
});

export const isCandidateDraftSnapshot = (
  value: unknown,
): value is CandidateDraft => {
  if (!inspectJsonSafety(value).ok) return false;
  const parsed = z.safeParse(candidateDraftShapeSchema, value);
  if (!parsed.success) return false;
  const candidate = parsed.data;
  const name = candidate.product.name;
  return (
    isSourcedValueSnapshot(name) &&
    ((typeof name.original === "string" && name.original.trim().length > 0) ||
      (typeof name.confirmed === "string" &&
        name.confirmed.trim().length > 0)) &&
    isAttributes(candidate.normalizedAttributes, candidate.category) &&
    isSourceState(candidate)
  );
};

const displayErrorSchema = plainObject({
  code: z.custom<ManagementDisplayError["code"]>((value) =>
    [
      "validation",
      "not-found",
      "conflict",
      "maintenance",
      "storage",
      "quota",
      "unsupported-data",
      "snapshot-restore-failed",
    ].includes(value as string),
  ),
});
const isDisplayError = (value: unknown): value is ManagementDisplayError =>
  schemaAccepts(displayErrorSchema, value);

const createEditorSchema = plainObject({
  mode: z.literal("create"),
  projectId: uuid<ProjectId>(),
  draft: z.unknown(),
});
const editEditorSchema = plainObject({
  mode: z.literal("edit"),
  projectId: uuid<ProjectId>(),
  candidateId: uuid(),
  draft: z.unknown(),
});
const isEditorEnvelope = (value: unknown): boolean =>
  schemaAccepts(createEditorSchema, value) ||
  schemaAccepts(editEditorSchema, value);

const projectDeletionSchema = plainObject({
  kind: z.literal("project"),
  projectId: uuid<ProjectId>(),
});
const candidateDeletionSchema = plainObject({
  kind: z.literal("candidate"),
  candidateId: uuid(),
});
const isDeletion = (value: unknown): value is DeletionConfirmation =>
  schemaAccepts(projectDeletionSchema, value) ||
  schemaAccepts(candidateDeletionSchema, value);

const invalid = <S extends Parameters<typeof tagged>[0]>(schema: S): S =>
  tagged(schema, "invalid-shape");
const managementSnapshotSchema = plainObject({
  version: invalid(z.literal(3)),
  selectedProjectId: invalid(
    z.custom<ProjectId | null>(
      (value) => value === null || (typeof value === "string" && isUuid(value)),
    ),
  ),
  selectedCategory: invalid(
    z.custom<PartCategory | null>(
      (value) => value === null || isPartCategory(value),
    ),
  ),
  editor: invalid(
    z.custom<CandidateEditor | null>(
      (value) => value === null || isEditorEnvelope(value),
    ),
  ),
  deletion: invalid(
    z.custom<DeletionConfirmation | null>(
      (value) => value === null || isDeletion(value),
    ),
  ),
  displayError: invalid(
    z.custom<ManagementDisplayError | null>(
      (value) => value === null || isDisplayError(value),
    ),
  ),
  duplicateDecision: z.unknown(),
});

const hasReference = (state: ManagementState, projectId: string): boolean =>
  state.value.projects.some((project) => project.id === projectId);

const hasValidReferences = (
  state: ManagementState,
  snapshot: RestoredManagementStateSnapshot,
): boolean => {
  if (
    snapshot.selectedProjectId !== null &&
    !hasReference(state, snapshot.selectedProjectId)
  ) {
    return false;
  }
  if (
    snapshot.editor !== null &&
    (!hasReference(state, snapshot.editor.projectId) ||
      snapshot.editor.draft.projectId !== snapshot.editor.projectId ||
      (snapshot.editor.mode === "edit" &&
        !state.hasCandidateReference(
          snapshot.editor.candidateId,
          snapshot.editor.projectId,
        )))
  ) {
    return false;
  }
  const deletion = snapshot.deletion;
  if (
    deletion !== null &&
    !(deletion.kind === "project"
      ? hasReference(state, deletion.projectId)
      : state.value.projects.some((project) =>
          state.hasCandidateReference(deletion.candidateId, project.id),
        ))
  )
    return false;

  const duplicate = snapshot.duplicateDecision;
  if (duplicate.status === "idle") return true;
  if (
    snapshot.editor?.mode !== "create" ||
    snapshot.editor.projectId !== duplicate.draft.projectId ||
    JSON.stringify(snapshot.editor.draft) !== JSON.stringify(duplicate.draft)
  )
    return false;
  if (duplicate.status !== "deciding" && duplicate.status !== "failed")
    return true;
  return duplicate.matches.every((match) =>
    state.hasCandidateReference(match.candidateId, duplicate.draft.projectId),
  );
};

export const createManagementStateSnapshotCodec = (
  state: ManagementState,
  duplicateCodec: DuplicateMergeStateSnapshotCodec,
): ManagementStateSnapshotCodec => ({
  capture(current): ManagementStateSnapshot {
    const {
      selectedProjectId,
      selectedCategory,
      editor,
      deletion,
      displayError,
      duplicateDecision,
    } = current.value;
    return {
      version: 3,
      selectedProjectId,
      selectedCategory,
      editor,
      deletion,
      displayError,
      duplicateDecision: duplicateCodec.capture(duplicateDecision),
    };
  },

  restore(input) {
    if (
      typeof input === "object" &&
      input !== null &&
      "version" in input &&
      input.version !== 3
    ) {
      return { ok: false, error: { kind: "unsupported-version" } };
    }
    if (!inspectJsonSafety(input).ok)
      return { ok: false, error: { kind: "invalid-shape" } };
    const decoded = decodeWithProfile(managementSnapshotSchema, input, {
      toError: (): ManagementSnapshotError => ({ kind: "invalid-shape" }),
    });
    if (!decoded.ok) return decoded;
    const editor = decoded.value.editor;
    if (editor !== null && !isCandidateDraftSnapshot(editor.draft)) {
      return { ok: false, error: { kind: "invalid-draft" } };
    }

    const restoredDuplicate =
      decoded.value.duplicateDecision === null
        ? ({ ok: true, value: { status: "idle" } } as const)
        : duplicateCodec.restore(decoded.value.duplicateDecision);
    if (!restoredDuplicate.ok)
      return { ok: false, error: { kind: "invalid-shape" } };

    const snapshot: RestoredManagementStateSnapshot = {
      version: 3,
      selectedProjectId: decoded.value.selectedProjectId,
      selectedCategory: decoded.value.selectedCategory,
      editor: decoded.value.editor,
      deletion: decoded.value.deletion,
      displayError: decoded.value.displayError,
      duplicateDecision: restoredDuplicate.value,
    };
    return hasValidReferences(state, snapshot)
      ? { ok: true, value: snapshot }
      : { ok: false, error: { kind: "invalid-reference" } };
  },
});
