import type { CandidatePart, LocalDataRoot } from "./model.js";
import type { JsonValue } from "./normalized-attributes.js";
import type { Result } from "./result.js";

const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID_PATTERN.test(value);
const isRequestId = isUuid;
const isRevision = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const isUtcTimestamp = (value: unknown): value is string => {
  if (typeof value !== "string" || !UTC_PATTERN.test(value)) return false;
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString().replace(".000Z", "Z") ===
      value.replace(".000Z", "Z")
  );
};
const PART_CATEGORIES = [
  "cpu",
  "cpu-cooler",
  "motherboard",
  "memory",
  "gpu",
  "storage",
  "power-supply",
  "case",
  "case-fan",
  "expansion-card",
  "other",
  "uncategorized",
] as const;

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

type RecordValue = Record<string, unknown>;
const fail = (code: ValidationErrorCode, path: string) => err({ code, path });
const isRecord = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const forbiddenKey =
  /(?:^|[-_])(html|image|images|image-data|imageData|binary|blob)(?:$|[-_])/i;
const RAW_HTML_PATTERN = /<(?:!doctype\s+html|!--|\/?[a-z][^>]*>)/i;

const inspectPayload = (
  value: unknown,
  path: string,
  ancestors: ReadonlySet<object> = new Set(),
): ValidationError | undefined => {
  if (
    typeof value === "string" &&
    (/^data:/i.test(value) || RAW_HTML_PATTERN.test(value))
  )
    return { code: "forbidden-payload", path };
  const traversable = Array.isArray(value) || isRecord(value);
  if (traversable && ancestors.has(value))
    return { code: "forbidden-payload", path };
  const descendantAncestors = traversable
    ? new Set([...ancestors, value])
    : ancestors;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const issue = inspectPayload(
        item,
        `${path}[${index}]`,
        descendantAncestors,
      );
      if (issue) return issue;
    }
  } else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      const itemPath = `${path}.${key}`;
      if (forbiddenKey.test(key))
        return { code: "forbidden-payload", path: itemPath };
      const issue = inspectPayload(item, itemPath, descendantAncestors);
      if (issue) return issue;
    }
  }
  return undefined;
};

/** Shared untrusted-message guard for JSON-safe, non-embedded payloads. */
export const validateSerializablePayload = (
  input: unknown,
  path = "$",
): Result<unknown, ValidationError> => {
  const issue = inspectPayload(input, path);
  if (issue) return err(issue);
  return isJsonValue(input) ? ok(input) : fail("forbidden-payload", path);
};

const object = (
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Result<RecordValue, ValidationError> => {
  if (!isRecord(value)) return fail("missing-field", path);
  for (const key of required)
    if (!(key in value)) return fail("missing-field", `${path}.${key}`);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value))
    if (!allowed.has(key)) return fail("unexpected-field", `${path}.${key}`);
  return ok(value);
};

const string = (value: unknown, path: string): ValidationError | undefined =>
  typeof value === "string" ? undefined : { code: "invalid-string", path };
const uuid = (value: unknown, path: string): ValidationError | undefined =>
  isUuid(value) ? undefined : { code: "invalid-uuid", path };
const utc = (value: unknown, path: string): ValidationError | undefined =>
  isUtcTimestamp(value) ? undefined : { code: "invalid-utc-timestamp", path };
const url = (value: unknown, path: string): ValidationError | undefined => {
  if (typeof value !== "string") return { code: "invalid-url", path };
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? undefined
      : { code: "invalid-url", path };
  } catch {
    return { code: "invalid-url", path };
  }
};

const sourced = (
  value: unknown,
  path: string,
  confirmed: "string" | "strings" | "money" = "string",
): ValidationError | undefined => {
  const result = object(value, path, ["original"], ["confirmed"]);
  if (!result.ok) return result.error;
  if (
    result.value.original !== null &&
    typeof result.value.original !== "string"
  )
    return { code: "invalid-string", path: `${path}.original` };
  if (!("confirmed" in result.value)) return undefined;
  const valueConfirmed = result.value.confirmed;
  if (confirmed === "string")
    return string(valueConfirmed, `${path}.confirmed`);
  if (confirmed === "strings")
    return Array.isArray(valueConfirmed) &&
      valueConfirmed.every((item) => typeof item === "string")
      ? undefined
      : { code: "invalid-array", path: `${path}.confirmed` };
  const money = object(valueConfirmed, `${path}.confirmed`, [
    "amount",
    "currency",
  ]);
  if (!money.ok) return money.error;
  if (
    typeof money.value.amount !== "number" ||
    !Number.isFinite(money.value.amount)
  )
    return { code: "invalid-integer", path: `${path}.confirmed.amount` };
  return string(money.value.currency, `${path}.confirmed.currency`);
};

const product = (value: unknown, path: string): ValidationError | undefined => {
  const result = object(
    value,
    path,
    [],
    ["name", "manufacturer", "modelNumber", "notes"],
  );
  if (!result.ok) return result.error;
  for (const key of ["name", "manufacturer", "modelNumber", "notes"] as const)
    if (key in result.value) {
      const issue = sourced(result.value[key], `${path}.${key}`);
      if (issue) return issue;
    }
  return undefined;
};

const sourceSnapshot = (
  value: unknown,
  path: string,
): ValidationError | undefined => {
  if (!isRecord(value)) return { code: "missing-field", path };
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    return { code: "forbidden-payload", path };
  for (const key of Object.getOwnPropertySymbols(value)) {
    if (Object.prototype.propertyIsEnumerable.call(value, key))
      return { code: "forbidden-payload", path: `${path}.${String(key)}` };
  }
  for (const [key, snapshotValue] of Object.entries(value)) {
    if (snapshotValue === null || typeof snapshotValue === "string") continue;
    return {
      code: isJsonValue(snapshotValue) ? "invalid-string" : "forbidden-payload",
      path: `${path}.${key}`,
    };
  }
  return undefined;
};

const attributeFields: Readonly<
  Record<string, Readonly<Record<string, "string" | "strings">>>
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

const attributes = (
  value: unknown,
  category: string,
  path: string,
): ValidationError | undefined => {
  const fields = attributeFields[category] ?? {};
  const result = object(value, path, ["category"], Object.keys(fields));
  if (!result.ok) return result.error;
  if (result.value.category !== category)
    return { code: "category-mismatch", path: `${path}.category` };
  for (const [key, kind] of Object.entries(fields))
    if (key in result.value) {
      const issue = sourced(result.value[key], `${path}.${key}`, kind);
      if (issue) return issue;
    }
  return undefined;
};

/** 識別子と保存日時を除いた候補パーツ内容。保存前のdraft検証単位でもある。 */
export type CandidatePartContent = Omit<
  CandidatePart,
  "id" | "createdAt" | "updatedAt"
>;

const candidateSources = (
  candidate: RecordValue,
  path: string,
): ValidationError | undefined => {
  if (!Array.isArray(candidate.sources))
    return { code: "invalid-array", path: `${path}.sources` };
  const sourceIds = new Set<string>();
  for (const [index, value] of candidate.sources.entries()) {
    const sourcePath = `${path}.sources[${index}]`;
    const source = object(
      value,
      sourcePath,
      ["id"],
      ["pageUrl", "siteName", "capturedAt", "price", "kind"],
    );
    if (!source.ok) return source.error;
    const issue = uuid(source.value.id, `${sourcePath}.id`);
    if (issue) return issue;
    if (sourceIds.has(source.value.id as string))
      return { code: "duplicate-id", path: `${sourcePath}.id` };
    sourceIds.add(source.value.id as string);
    for (const sourceIssue of [
      "pageUrl" in source.value
        ? url(source.value.pageUrl, `${sourcePath}.pageUrl`)
        : undefined,
      "siteName" in source.value
        ? string(source.value.siteName, `${sourcePath}.siteName`)
        : undefined,
      "capturedAt" in source.value
        ? utc(source.value.capturedAt, `${sourcePath}.capturedAt`)
        : undefined,
      "price" in source.value
        ? sourced(source.value.price, `${sourcePath}.price`, "money")
        : undefined,
    ])
      if (sourceIssue) return sourceIssue;
    if (
      "kind" in source.value &&
      source.value.kind !== "retail" &&
      source.value.kind !== "manufacturer"
    )
      return { code: "invalid-string", path: `${sourcePath}.kind` };
  }
  if (candidate.sources.length === 0) {
    if ("primarySourceId" in candidate)
      return { code: "unexpected-field", path: `${path}.primarySourceId` };
    return undefined;
  }
  if (!("primarySourceId" in candidate))
    return { code: "missing-field", path: `${path}.primarySourceId` };
  const issue = uuid(candidate.primarySourceId, `${path}.primarySourceId`);
  if (issue) return issue;
  if (!sourceIds.has(candidate.primarySourceId as string))
    return { code: "missing-reference", path: `${path}.primarySourceId` };
  return undefined;
};

/**
 * 識別子と日時を伴わない候補パーツ内容のcanonical shape validator。
 * 保存前のdraftは、rootや無関係なaggregateを組み立てずにこの入口だけで検証する。
 */
export const validateCandidatePartContent = (
  input: unknown,
  path = "$",
): Result<CandidatePartContent, ValidationError> => {
  const prohibited = inspectPayload(input, path);
  if (prohibited) return err(prohibited);
  const content = object(
    input,
    path,
    ["projectId", "category", "product", "sources", "normalizedAttributes"],
    ["primarySourceId", "sourceSnapshot"],
  );
  if (!content.ok) return content;
  const projectIdIssue = uuid(content.value.projectId, `${path}.projectId`);
  if (projectIdIssue) return err(projectIdIssue);
  if (!PART_CATEGORIES.includes(content.value.category as never))
    return fail("category-mismatch", `${path}.category`);
  let issue = product(content.value.product, `${path}.product`);
  if (issue) return err(issue);
  if ("sourceSnapshot" in content.value) {
    issue = sourceSnapshot(
      content.value.sourceSnapshot,
      `${path}.sourceSnapshot`,
    );
    if (issue) return err(issue);
  }
  issue = attributes(
    content.value.normalizedAttributes,
    content.value.category as string,
    `${path}.normalizedAttributes`,
  );
  if (issue) return err(issue);
  issue = candidateSources(content.value, path);
  if (issue) return err(issue);
  return ok(input as CandidatePartContent);
};

/**
 * CandidatePart単体のcanonical shape validator。
 * project参照・ID重複などaggregate文脈の検証はvalidateRootが追加で担う。
 */
export const validateCandidatePartValue = (
  input: unknown,
  path = "$",
): Result<CandidatePart, ValidationError> => {
  const prohibited = inspectPayload(input, path);
  if (prohibited) return err(prohibited);
  const candidate = object(
    input,
    path,
    [
      "id",
      "projectId",
      "category",
      "product",
      "sources",
      "normalizedAttributes",
      "createdAt",
      "updatedAt",
    ],
    ["primarySourceId", "sourceSnapshot"],
  );
  if (!candidate.ok) return candidate;
  for (const issue of [
    uuid(candidate.value.id, `${path}.id`),
    utc(candidate.value.createdAt, `${path}.createdAt`),
    utc(candidate.value.updatedAt, `${path}.updatedAt`),
  ])
    if (issue) return err(issue);
  const content: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(candidate.value))
    if (key !== "id" && key !== "createdAt" && key !== "updatedAt")
      content[key] = value;
  const validated = validateCandidatePartContent(content, path);
  if (!validated.ok) return validated;
  return ok(input as CandidatePart);
};

const validateRootAt = <T extends LocalDataRoot>(
  input: unknown,
  base = "$",
): Result<T, ValidationError> => {
  const prohibited = inspectPayload(input, base);
  if (prohibited) return err(prohibited);
  const root = object(input, base, [
    "schemaVersion",
    "revision",
    "projects",
    "candidateParts",
    "currentBuilds",
    "requestDedupe",
    "maintenance",
  ]);
  if (!root.ok) return root;
  if (root.value.schemaVersion !== 1)
    return fail("unsupported-schema", `${base}.schemaVersion`);
  if (!isRevision(root.value.revision))
    return fail("invalid-integer", `${base}.revision`);
  for (const key of [
    "projects",
    "candidateParts",
    "currentBuilds",
    "requestDedupe",
  ] as const)
    if (!Array.isArray(root.value[key]))
      return fail("invalid-array", `${base}.${key}`);
  const projects = root.value.projects as unknown[];
  const candidates = root.value.candidateParts as unknown[];
  const builds = root.value.currentBuilds as unknown[];
  const dedupe = root.value.requestDedupe as unknown[];
  const projectIds = new Set<string>();
  for (const [i, item] of projects.entries()) {
    const path = `${base}.projects[${i}]`;
    const project = object(item, path, [
      "id",
      "name",
      "createdAt",
      "updatedAt",
    ]);
    if (!project.ok) return project;
    for (const issue of [
      uuid(project.value.id, `${path}.id`),
      string(project.value.name, `${path}.name`),
      utc(project.value.createdAt, `${path}.createdAt`),
      utc(project.value.updatedAt, `${path}.updatedAt`),
    ])
      if (issue) return err(issue);
    if (projectIds.has(project.value.id as string))
      return fail("duplicate-id", `${path}.id`);
    projectIds.add(project.value.id as string);
  }
  const candidateIds = new Map<string, string>();
  for (const [i, item] of candidates.entries()) {
    const path = `${base}.candidateParts[${i}]`;
    const candidate = validateCandidatePartValue(item, path);
    if (!candidate.ok) return candidate;
    if (!projectIds.has(candidate.value.projectId as string))
      return fail("missing-reference", `${path}.projectId`);
    if (candidateIds.has(candidate.value.id as string))
      return fail("duplicate-id", `${path}.id`);
    candidateIds.set(
      candidate.value.id as string,
      candidate.value.projectId as string,
    );
  }
  const buildIds = new Set<string>();
  for (const [i, item] of builds.entries()) {
    const path = `${base}.currentBuilds[${i}]`;
    const build = object(item, path, ["id", "projectId", "items", "updatedAt"]);
    if (!build.ok) return build;
    for (const issue of [
      uuid(build.value.id, `${path}.id`),
      uuid(build.value.projectId, `${path}.projectId`),
      utc(build.value.updatedAt, `${path}.updatedAt`),
    ])
      if (issue) return err(issue);
    if (!projectIds.has(build.value.projectId as string))
      return fail("missing-reference", `${path}.projectId`);
    if (buildIds.has(build.value.id as string))
      return fail("duplicate-id", `${path}.id`);
    buildIds.add(build.value.id as string);
    if (!Array.isArray(build.value.items))
      return fail("invalid-array", `${path}.items`);
    for (const [j, itemValue] of build.value.items.entries()) {
      const itemPath = `${path}.items[${j}]`;
      const buildItem = object(itemValue, itemPath, [
        "candidatePartId",
        "quantity",
      ]);
      if (!buildItem.ok) return buildItem;
      const idIssue = uuid(
        buildItem.value.candidatePartId,
        `${itemPath}.candidatePartId`,
      );
      if (idIssue) return err(idIssue);
      if (
        candidateIds.get(buildItem.value.candidatePartId as string) !==
        build.value.projectId
      )
        return fail("missing-reference", `${itemPath}.candidatePartId`);
      if (
        !Number.isSafeInteger(buildItem.value.quantity) ||
        (buildItem.value.quantity as number) <= 0
      )
        return fail("invalid-positive-integer", `${itemPath}.quantity`);
    }
  }
  const requestIds = new Set<string>();
  for (const [i, item] of dedupe.entries()) {
    const path = `${base}.requestDedupe[${i}]`;
    const record = object(item, path, [
      "requestId",
      "payloadDigest",
      "committedRevision",
    ]);
    if (!record.ok) return record;
    if (!isRequestId(record.value.requestId))
      return fail("invalid-uuid", `${path}.requestId`);
    if (requestIds.has(record.value.requestId))
      return fail("duplicate-id", `${path}.requestId`);
    requestIds.add(record.value.requestId);
    const digestIssue = string(
      record.value.payloadDigest,
      `${path}.payloadDigest`,
    );
    if (digestIssue) return err(digestIssue);
    if (!isRevision(record.value.committedRevision))
      return fail("invalid-integer", `${path}.committedRevision`);
  }
  const maintenance = object(
    root.value.maintenance,
    `${base}.maintenance`,
    ["generation", "active"],
    ["ownerId", "leaseExpiresAt"],
  );
  if (!maintenance.ok) return maintenance;
  if (
    !Number.isSafeInteger(maintenance.value.generation) ||
    (maintenance.value.generation as number) < 0
  )
    return fail("invalid-integer", `${base}.maintenance.generation`);
  if (typeof maintenance.value.active !== "boolean")
    return fail("invalid-boolean", `${base}.maintenance.active`);
  if (maintenance.value.active) {
    for (const key of ["ownerId", "leaseExpiresAt"])
      if (!(key in maintenance.value))
        return fail("missing-field", `${base}.maintenance.${key}`);
    const ownerIssue = uuid(
      maintenance.value.ownerId,
      `${base}.maintenance.ownerId`,
    );
    if (ownerIssue) return err(ownerIssue);
    const leaseIssue = utc(
      maintenance.value.leaseExpiresAt,
      `${base}.maintenance.leaseExpiresAt`,
    );
    if (leaseIssue) return err(leaseIssue);
  } else if (
    "ownerId" in maintenance.value ||
    "leaseExpiresAt" in maintenance.value
  )
    return fail(
      "unexpected-field",
      `${base}.maintenance.${"ownerId" in maintenance.value ? "ownerId" : "leaseExpiresAt"}`,
    );
  return ok(input as T);
};

export const schemaValidator: SchemaValidator = {
  validateRoot: (input) => validateRootAt<LocalDataRoot>(input),
  validateReplacement: (input) => validateRootAt<LocalDataRoot>(input),
  validateCommand(input) {
    const prohibited = inspectPayload(input, "$");
    if (prohibited) return err(prohibited);
    const command = object(
      input,
      "$",
      ["kind"],
      ["requestId", "expectedRevision", "proposedRoot"],
    );
    if (!command.ok) return command;
    if (command.value.kind === "query-root") {
      if (Object.keys(command.value).length !== 1)
        return fail(
          "unexpected-field",
          `$.${Object.keys(command.value).find((key) => key !== "kind")}`,
        );
      return ok(input as DataCommand);
    }
    if (command.value.kind !== "mutate-root")
      return fail("invalid-string", "$.kind");
    for (const key of ["requestId", "expectedRevision", "proposedRoot"])
      if (!(key in command.value)) return fail("missing-field", `$.${key}`);
    if (!isRequestId(command.value.requestId))
      return fail("invalid-uuid", "$.requestId");
    if (!isRevision(command.value.expectedRevision))
      return fail("invalid-integer", "$.expectedRevision");
    const proposed = validateRootAt(
      command.value.proposedRoot,
      "$.proposedRoot",
    );
    if (!proposed.ok) return proposed;
    return ok(input as DataCommand);
  },
};

export const isJsonValue = (value: unknown): value is JsonValue => {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
};
