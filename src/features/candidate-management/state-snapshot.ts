import {
  isJsonValue,
  PART_CATEGORIES,
  type PartCategory,
  type ProjectId,
  type Result,
} from "../../domain/public.js";
import type { CandidateDraft } from "./contracts.js";
import type {
  CandidateEditor,
  DeletionConfirmation,
  ManagementDisplayError,
  ManagementState,
} from "./state.js";

export interface ManagementStateSnapshot {
  readonly version: 2;
  readonly selectedProjectId: ProjectId | null;
  readonly selectedCategory: PartCategory | null;
  readonly editor: CandidateEditor | null;
  readonly deletion: DeletionConfirmation | null;
  readonly displayError: ManagementDisplayError | null;
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
  ): Result<ManagementStateSnapshot, ManagementSnapshotError>;
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

const isUtcTimestamp = (value: unknown): value is string => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  ) {
    return false;
  }
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString().replace(".000Z", "Z") ===
      value.replace(".000Z", "Z")
  );
};

const isSourcedValue = (
  value: unknown,
  confirmed: "string" | "strings" | "money" = "string",
): value is {
  readonly original: string | null;
  readonly confirmed?: unknown;
} => {
  if (
    !isRecord(value) ||
    !Object.keys(value).every(
      (key) => key === "original" || key === "confirmed",
    ) ||
    !("original" in value) ||
    (value.original !== null && !isSafeString(value.original))
  ) {
    return false;
  }
  if (!("confirmed" in value)) return true;
  if (confirmed === "string") return isSafeString(value.confirmed);
  if (confirmed === "strings")
    return (
      Array.isArray(value.confirmed) && value.confirmed.every(isSafeString)
    );
  return (
    isRecord(value.confirmed) &&
    hasOnlyKeys(value.confirmed, ["amount", "currency"]) &&
    typeof value.confirmed.amount === "number" &&
    Number.isFinite(value.confirmed.amount) &&
    isSafeString(value.confirmed.currency)
  );
};

const isProduct = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  const fields = ["name", "manufacturer", "modelNumber", "notes"];
  if (!Object.keys(value).every((key) => fields.includes(key))) return false;
  return (
    (!("name" in value) || isSourcedValue(value.name)) &&
    (!("manufacturer" in value) || isSourcedValue(value.manufacturer)) &&
    (!("modelNumber" in value) || isSourcedValue(value.modelNumber)) &&
    (!("notes" in value) || isSourcedValue(value.notes))
  );
};

const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

const isHttpUrl = (value: unknown): value is string => {
  if (!isSafeString(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const isCandidateSource = (value: unknown): boolean =>
  isRecord(value) &&
  Object.keys(value).every((key) =>
    ["id", "pageUrl", "siteName", "capturedAt", "price", "kind"].includes(key),
  ) &&
  isUuid(value.id) &&
  (!("pageUrl" in value) || isHttpUrl(value.pageUrl)) &&
  (!("siteName" in value) || isSafeString(value.siteName)) &&
  (!("capturedAt" in value) || isUtcTimestamp(value.capturedAt)) &&
  (!("price" in value) || isSourcedValue(value.price, "money")) &&
  (!("kind" in value) ||
    value.kind === "retail" ||
    value.kind === "manufacturer");

const isSourceState = (value: Record<string, unknown>): boolean => {
  if (!Array.isArray(value.sources) || !value.sources.every(isCandidateSource))
    return false;
  const ids = value.sources.map((source) => (source as { id: string }).id);
  if (new Set(ids).size !== ids.length) return false;
  return value.sources.length === 0
    ? !("primarySourceId" in value) || value.primarySourceId === undefined
    : isUuid(value.primarySourceId) && ids.includes(value.primarySourceId);
};

const isSourceSnapshot = (value: unknown): boolean =>
  isRecord(value) &&
  Object.values(value).every((item) => item === null || isSafeString(item));

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
      ([key, kind]) => !(key in value) || isSourcedValue(value[key], kind),
    )
  );
};

const isDraft = (value: unknown): value is CandidateDraft => {
  if (!isRecord(value) || !isPartCategory(value.category)) return false;
  const name = isRecord(value.product) ? value.product.name : undefined;
  return (
    isJsonValue(value) &&
    Object.keys(value).every((key) =>
      [
        "projectId",
        "category",
        "product",
        "normalizedAttributes",
        "sources",
        "primarySourceId",
        "sourceSnapshot",
      ].includes(key),
    ) &&
    typeof value.projectId === "string" &&
    isProduct(value.product) &&
    isSourcedValue(name) &&
    ((typeof name.original === "string" && name.original.trim().length > 0) ||
      (typeof name.confirmed === "string" &&
        name.confirmed.trim().length > 0)) &&
    isAttributes(value.normalizedAttributes, value.category) &&
    isSourceState(value) &&
    (!("sourceSnapshot" in value) || isSourceSnapshot(value.sourceSnapshot))
  );
};

const isDisplayError = (value: unknown): value is ManagementDisplayError =>
  isRecord(value) &&
  typeof value.code === "string" &&
  [
    "validation",
    "not-found",
    "conflict",
    "maintenance",
    "storage",
    "quota",
    "unsupported-data",
  ].includes(value.code) &&
  hasOnlyKeys(value, ["code"]);

const isEditorEnvelope = (value: unknown): boolean => {
  if (
    !isRecord(value) ||
    !isRecord(value.draft) ||
    typeof value.projectId !== "string"
  ) {
    return false;
  }
  if (value.mode === "create")
    return hasOnlyKeys(value, ["mode", "projectId", "draft"]);
  return (
    value.mode === "edit" &&
    typeof value.candidateId === "string" &&
    hasOnlyKeys(value, ["mode", "projectId", "candidateId", "draft"])
  );
};

const isDeletion = (value: unknown): value is DeletionConfirmation =>
  isRecord(value) &&
  ((value.kind === "project" &&
    typeof value.projectId === "string" &&
    hasOnlyKeys(value, ["kind", "projectId"])) ||
    (value.kind === "candidate" &&
      typeof value.candidateId === "string" &&
      hasOnlyKeys(value, ["kind", "candidateId"])));

const hasReference = (state: ManagementState, projectId: string): boolean =>
  state.value.projects.some((project) => project.id === projectId);

const hasValidReferences = (
  state: ManagementState,
  snapshot: ManagementStateSnapshot,
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
  if (deletion === null) return true;
  return deletion.kind === "project"
    ? hasReference(state, deletion.projectId)
    : state.value.projects.some((project) =>
        state.hasCandidateReference(deletion.candidateId, project.id),
      );
};

export const createManagementStateSnapshotCodec = (
  state: ManagementState,
): ManagementStateSnapshotCodec => ({
  capture(current): ManagementStateSnapshot {
    const {
      selectedProjectId,
      selectedCategory,
      editor,
      deletion,
      displayError,
    } = current.value;
    return {
      version: 2,
      selectedProjectId,
      selectedCategory,
      editor,
      deletion,
      displayError,
    };
  },

  restore(input) {
    if (!isRecord(input))
      return { ok: false, error: { kind: "invalid-shape" } };
    if (input.version !== 2) {
      return { ok: false, error: { kind: "unsupported-version" } };
    }
    const editor = input.editor;
    if (
      !hasOnlyKeys(input, [
        "version",
        "selectedProjectId",
        "selectedCategory",
        "editor",
        "deletion",
        "displayError",
      ]) ||
      (input.selectedProjectId !== null &&
        typeof input.selectedProjectId !== "string") ||
      (input.selectedCategory !== null &&
        !isPartCategory(input.selectedCategory)) ||
      (editor !== null && !isEditorEnvelope(editor)) ||
      (input.deletion !== null && !isDeletion(input.deletion)) ||
      (input.displayError !== null && !isDisplayError(input.displayError))
    ) {
      return { ok: false, error: { kind: "invalid-shape" } };
    }
    if (editor !== null && isRecord(editor) && !isDraft(editor.draft)) {
      return { ok: false, error: { kind: "invalid-draft" } };
    }

    const snapshot: ManagementStateSnapshot = {
      version: 2,
      selectedProjectId: input.selectedProjectId as ProjectId | null,
      selectedCategory: input.selectedCategory as PartCategory | null,
      editor: input.editor as CandidateEditor | null,
      deletion: input.deletion as DeletionConfirmation | null,
      displayError: input.displayError as ManagementDisplayError | null,
    };
    return hasValidReferences(state, snapshot)
      ? { ok: true, value: snapshot }
      : { ok: false, error: { kind: "invalid-reference" } };
  },
});
