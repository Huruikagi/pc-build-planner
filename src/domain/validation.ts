/**
 * Local data foundation boundary validation.
 *
 * Shapes are declared as owner-local schemas (`foundation-schema.ts`); this
 * module owns the order in which they run and every rule that needs more than
 * one value: identifier uniqueness, ownership, references and the conditional
 * source/maintenance contracts. That split is what keeps the external contract
 * — `Result<T, E>`, `ValidationErrorCode` and the canonical path — unchanged.
 */
import {
  activeMaintenanceSchema,
  attributesSchemaFor,
  buildItemSchema,
  candidateContentSchema,
  candidateDraftSchema,
  candidatePartValueSchema,
  candidateSourceIdSchema,
  candidateSourceSchema,
  commandEnvelopeSchema,
  currentBuildSchema,
  inactiveMaintenanceSchema,
  maintenanceEnvelopeSchema,
  mutateCommandSchema,
  projectSchema,
  queryCommandSchema,
  requestDedupeSchema,
  rootEnvelopeSchema,
} from "./foundation-schema.js";
import type {
  CandidatePart,
  CandidatePartId,
  CandidateSourceId,
  CurrentBuildId,
  LocalDataRoot,
  ProjectId,
} from "./model.js";
import type { JsonValue, PartCategory } from "./normalized-attributes.js";
import { err, ok, type Result } from "./result.js";
import {
  decodeWithProfile,
  type IssueMappingProfile,
  inspectJsonSafety,
  type SchemaIssueView,
  type SchemaNode,
  STRUCTURAL_ISSUES,
} from "./runtime-schema/public.js";

export type ValidationErrorCode =
  | "category-mismatch"
  | "duplicate-id"
  | "forbidden-payload"
  | "invalid-array"
  | "invalid-boolean"
  | "invalid-integer"
  | "invalid-positive-integer"
  | "invalid-string"
  | "invalid-url"
  | "invalid-utc-timestamp"
  | "invalid-uuid"
  | "missing-field"
  | "missing-reference"
  | "unexpected-field"
  | "unsupported-schema";

export interface ValidationError {
  readonly code: ValidationErrorCode;
  readonly path: string;
}

/** Canonical validation path for a candidate source URL field. */
export const candidateSourcePageUrlPath = (index: number): string =>
  `sources[${index}].pageUrl`;

export type ReplaceableRoot = LocalDataRoot;

export type DataCommand =
  | { readonly kind: "query-root" }
  | {
      readonly kind: "mutate-root";
      readonly requestId: import("./identifiers.js").RequestId;
      readonly expectedRevision: import("./identifiers.js").Revision;
      readonly proposedRoot: LocalDataRoot;
    };

export interface SchemaValidator {
  validateRoot(input: unknown): Result<LocalDataRoot, ValidationError>;
  validateCommand(input: unknown): Result<DataCommand, ValidationError>;
  validateReplacement(input: unknown): Result<ReplaceableRoot, ValidationError>;
}

const fail = (code: ValidationErrorCode, path: string): ValidationError => ({
  code,
  path,
});

/**
 * Structural failures carry no owner tag, so they are mapped from the shared
 * vocabulary instead. Everything else is mapped from the tag the schema node
 * declares — never from the path, which cannot distinguish these codes.
 */
const STRUCTURAL_CODES: Readonly<Record<string, ValidationErrorCode>> = {
  [STRUCTURAL_ISSUES.missingKey]: "missing-field",
  [STRUCTURAL_ISSUES.unexpectedKey]: "unexpected-field",
  [STRUCTURAL_ISSUES.notObject]: "missing-field",
  [STRUCTURAL_ISSUES.unsafeObject]: "forbidden-payload",
  [STRUCTURAL_ISSUES.undefinedValue]: "forbidden-payload",
};

const issueCode = (issue: SchemaIssueView): ValidationErrorCode =>
  // Every foundation tag is spelled as a `ValidationErrorCode`; an untagged
  // issue outside the structural vocabulary can only be an unexpected vendor
  // failure, which stays fail-closed.
  (issue.tag as ValidationErrorCode | undefined) ??
  STRUCTURAL_CODES[issue.code] ??
  "forbidden-payload";

const foundationProfile: IssueMappingProfile<ValidationError> = {
  toError: (issue, path) => fail(issueCode(issue), path),
};

const decode = <S extends SchemaNode>(
  schema: S,
  input: unknown,
  path: string,
) => decodeWithProfile(schema, input, foundationProfile, path);

/**
 * JSON safety runs before any shape: a cycle, a non-JSON value, a poisoned
 * prototype, an embedded document or a forbidden key rejects the whole input
 * at the first path where it is decided. Every kind is a forbidden payload for
 * this boundary.
 */
const jsonSafetyIssue = (
  input: unknown,
  path: string,
): ValidationError | undefined => {
  const inspected = inspectJsonSafety(input, path);
  return inspected.ok
    ? undefined
    : fail("forbidden-payload", inspected.error.path);
};

/** Shared untrusted-message guard for JSON-safe, non-embedded payloads. */
export const validateSerializablePayload = (
  input: unknown,
  path = "$",
): Result<unknown, ValidationError> => {
  const issue = jsonSafetyIssue(input, path);
  return issue ? err(issue) : ok(input);
};

/** 識別子と保存日時を除いた候補パーツ内容。保存前のdraft検証単位でもある。 */
export type CandidatePartContent = Omit<
  CandidatePart,
  "id" | "createdAt" | "updatedAt"
>;

/** Project selection has not been resolved yet, but the candidate shape is canonical. */
export type CandidatePartDraft = Omit<CandidatePartContent, "projectId"> & {
  readonly sources?: CandidatePartContent["sources"];
};

/** The part of a decoded candidate the ordered semantic pass still needs. */
interface CandidateBody {
  readonly category: PartCategory;
  readonly normalizedAttributes?: unknown;
  readonly sources?: unknown;
  readonly primarySourceId?: unknown;
}

/**
 * The source list decides the primary reference: an empty (or absent) list
 * must carry no primary, a non-empty one must carry a primary that resolves to
 * a source it contains.
 */
const candidateSourcesIssue = (
  body: CandidateBody,
  path: string,
): ValidationError | undefined => {
  const hasPrimary = body.primarySourceId !== undefined;
  if (body.sources === undefined)
    return hasPrimary
      ? fail("unexpected-field", `${path}.primarySourceId`)
      : undefined;
  if (!Array.isArray(body.sources))
    return fail("invalid-array", `${path}.sources`);
  const sourceIds = new Set<CandidateSourceId>();
  for (const [index, value] of body.sources.entries()) {
    const sourcePath = `${path}.sources[${index}]`;
    const source = decode(candidateSourceSchema, value, sourcePath);
    if (!source.ok) return source.error;
    if (sourceIds.has(source.value.id))
      return fail("duplicate-id", `${sourcePath}.id`);
    sourceIds.add(source.value.id);
  }
  if (sourceIds.size === 0)
    return hasPrimary
      ? fail("unexpected-field", `${path}.primarySourceId`)
      : undefined;
  if (!hasPrimary) return fail("missing-field", `${path}.primarySourceId`);
  const primaryPath = `${path}.primarySourceId`;
  const primary = decode(
    candidateSourceIdSchema,
    body.primarySourceId,
    primaryPath,
  );
  if (!primary.ok) return primary.error;
  return sourceIds.has(primary.value)
    ? undefined
    : fail("missing-reference", primaryPath);
};

/** Attribute shape depends on the already-validated category. */
const candidateBodyIssue = (
  body: CandidateBody,
  path: string,
): ValidationError | undefined => {
  const attributes = decode(
    attributesSchemaFor(body.category),
    body.normalizedAttributes,
    `${path}.normalizedAttributes`,
  );
  if (!attributes.ok) return attributes.error;
  return candidateSourcesIssue(body, path);
};

const candidateContentIssue = (
  input: unknown,
  path: string,
  projectRequired: boolean,
): ValidationError | undefined => {
  const safety = jsonSafetyIssue(input, path);
  if (safety) return safety;
  const decoded = projectRequired
    ? decode(candidateContentSchema, input, path)
    : decode(candidateDraftSchema, input, path);
  return decoded.ok ? candidateBodyIssue(decoded.value, path) : decoded.error;
};

/** Project未選択の編集draftを保存時と同じcanonical規則で検証する。 */
export const validateCandidatePartDraft = (
  input: unknown,
  path = "$",
): Result<CandidatePartDraft, ValidationError> => {
  const issue = candidateContentIssue(input, path, false);
  // The decoded value is discarded on purpose: callers rely on receiving the
  // very object they passed in, and the schema has just proved its shape.
  return issue ? err(issue) : ok(input as CandidatePartDraft);
};

/**
 * 識別子と日時を伴わない候補パーツ内容のcanonical shape validator。
 * 保存前のdraftは、rootや無関係なaggregateを組み立てずにこの入口だけで検証する。
 */
export const validateCandidatePartContent = (
  input: unknown,
  path = "$",
): Result<CandidatePartContent, ValidationError> => {
  const issue = candidateContentIssue(input, path, true);
  return issue ? err(issue) : ok(input as CandidatePartContent);
};

/**
 * CandidatePart単体のcanonical shape validator。
 * project参照・ID重複などaggregate文脈の検証はvalidateRootが追加で担う。
 */
export const validateCandidatePartValue = (
  input: unknown,
  path = "$",
): Result<CandidatePart, ValidationError> => {
  const safety = jsonSafetyIssue(input, path);
  if (safety) return err(safety);
  const decoded = decode(candidatePartValueSchema, input, path);
  if (!decoded.ok) return err(decoded.error);
  const issue = candidateBodyIssue(decoded.value, path);
  return issue ? err(issue) : ok(input as CandidatePart);
};

const maintenanceIssue = (
  input: unknown,
  path: string,
): ValidationError | undefined => {
  const envelope = decode(maintenanceEnvelopeSchema, input, path);
  if (!envelope.ok) return envelope.error;
  const state = envelope.value.active
    ? decode(activeMaintenanceSchema, input, path)
    : decode(inactiveMaintenanceSchema, input, path);
  return state.ok ? undefined : state.error;
};

const rootIssue = (
  input: unknown,
  base: string,
): ValidationError | undefined => {
  const safety = jsonSafetyIssue(input, base);
  if (safety) return safety;
  const root = decode(rootEnvelopeSchema, input, base);
  if (!root.ok) return root.error;

  const projectIds = new Set<ProjectId>();
  for (const [index, item] of root.value.projects.entries()) {
    const path = `${base}.projects[${index}]`;
    const project = decode(projectSchema, item, path);
    if (!project.ok) return project.error;
    if (projectIds.has(project.value.id))
      return fail("duplicate-id", `${path}.id`);
    projectIds.add(project.value.id);
  }

  const candidateOwners = new Map<CandidatePartId, ProjectId>();
  for (const [index, item] of root.value.candidateParts.entries()) {
    const path = `${base}.candidateParts[${index}]`;
    const candidate = validateCandidatePartValue(item, path);
    if (!candidate.ok) return candidate.error;
    if (!projectIds.has(candidate.value.projectId))
      return fail("missing-reference", `${path}.projectId`);
    if (candidateOwners.has(candidate.value.id))
      return fail("duplicate-id", `${path}.id`);
    candidateOwners.set(candidate.value.id, candidate.value.projectId);
  }

  const buildIds = new Set<CurrentBuildId>();
  for (const [index, item] of root.value.currentBuilds.entries()) {
    const path = `${base}.currentBuilds[${index}]`;
    const build = decode(currentBuildSchema, item, path);
    if (!build.ok) return build.error;
    if (!projectIds.has(build.value.projectId))
      return fail("missing-reference", `${path}.projectId`);
    if (buildIds.has(build.value.id)) return fail("duplicate-id", `${path}.id`);
    buildIds.add(build.value.id);
    for (const [itemIndex, itemValue] of build.value.items.entries()) {
      const itemPath = `${path}.items[${itemIndex}]`;
      const buildItem = decode(buildItemSchema, itemValue, itemPath);
      if (!buildItem.ok) return buildItem.error;
      if (
        candidateOwners.get(buildItem.value.candidatePartId) !==
        build.value.projectId
      )
        return fail("missing-reference", `${itemPath}.candidatePartId`);
    }
  }

  const requestIds = new Set<string>();
  for (const [index, item] of root.value.requestDedupe.entries()) {
    const path = `${base}.requestDedupe[${index}]`;
    const record = decode(requestDedupeSchema, item, path);
    if (!record.ok) return record.error;
    if (requestIds.has(record.value.requestId))
      return fail("duplicate-id", `${path}.requestId`);
    requestIds.add(record.value.requestId);
  }

  return maintenanceIssue(root.value.maintenance, `${base}.maintenance`);
};

const validateRootAt = <T extends LocalDataRoot>(
  input: unknown,
  base = "$",
): Result<T, ValidationError> => {
  const issue = rootIssue(input, base);
  return issue ? err(issue) : ok(input as T);
};

export const schemaValidator: SchemaValidator = {
  validateRoot: (input) => validateRootAt<LocalDataRoot>(input),
  validateReplacement: (input) => validateRootAt<LocalDataRoot>(input),
  validateCommand(input) {
    const safety = jsonSafetyIssue(input, "$");
    if (safety) return err(safety);
    const envelope = decode(commandEnvelopeSchema, input, "$");
    if (!envelope.ok) return err(envelope.error);
    if (envelope.value.kind === "query-root") {
      const query = decode(queryCommandSchema, input, "$");
      return query.ok ? ok(input as DataCommand) : err(query.error);
    }
    if (envelope.value.kind !== "mutate-root")
      return err(fail("invalid-string", "$.kind"));
    const mutate = decode(mutateCommandSchema, input, "$");
    if (!mutate.ok) return err(mutate.error);
    const proposed = rootIssue(mutate.value.proposedRoot, "$.proposedRoot");
    return proposed ? err(proposed) : ok(input as DataCommand);
  },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isJsonValue = (value: unknown): value is JsonValue => {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
};
