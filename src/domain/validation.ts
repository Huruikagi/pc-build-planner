import type { LocalDataRoot } from "./model.js";
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
): ValidationError | undefined => {
  if (
    typeof value === "string" &&
    (/^data:/i.test(value) || RAW_HTML_PATTERN.test(value))
  )
    return { code: "forbidden-payload", path };
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const issue = inspectPayload(item, `${path}[${index}]`);
      if (issue) return issue;
    }
  } else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      const itemPath = `${path}.${key}`;
      if (forbiddenKey.test(key))
        return { code: "forbidden-payload", path: itemPath };
      const issue = inspectPayload(item, itemPath);
      if (issue) return issue;
    }
  }
  return undefined;
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
    ["name", "manufacturer", "modelNumber", "price", "notes"],
  );
  if (!result.ok) return result.error;
  for (const key of ["name", "manufacturer", "modelNumber", "notes"] as const)
    if (key in result.value) {
      const issue = sourced(result.value[key], `${path}.${key}`);
      if (issue) return issue;
    }
  return "price" in result.value
    ? sourced(result.value.price, `${path}.price`, "money")
    : undefined;
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

const validateRootAt = (
  input: unknown,
  base = "$",
): Result<LocalDataRoot, ValidationError> => {
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
    const candidate = object(item, path, [
      "id",
      "projectId",
      "category",
      "product",
      "sourceInfo",
      "normalizedAttributes",
      "createdAt",
      "updatedAt",
    ]);
    if (!candidate.ok) return candidate;
    for (const issue of [
      uuid(candidate.value.id, `${path}.id`),
      uuid(candidate.value.projectId, `${path}.projectId`),
      utc(candidate.value.createdAt, `${path}.createdAt`),
      utc(candidate.value.updatedAt, `${path}.updatedAt`),
    ])
      if (issue) return err(issue);
    if (!projectIds.has(candidate.value.projectId as string))
      return fail("missing-reference", `${path}.projectId`);
    if (candidateIds.has(candidate.value.id as string))
      return fail("duplicate-id", `${path}.id`);
    if (!PART_CATEGORIES.includes(candidate.value.category as never))
      return fail("category-mismatch", `${path}.category`);
    let issue = product(candidate.value.product, `${path}.product`);
    if (issue) return err(issue);
    const source = object(
      candidate.value.sourceInfo,
      `${path}.sourceInfo`,
      ["pageUrl", "capturedAt"],
      ["siteName"],
    );
    if (!source.ok) return source;
    for (const valueIssue of [
      url(source.value.pageUrl, `${path}.sourceInfo.pageUrl`),
      utc(source.value.capturedAt, `${path}.sourceInfo.capturedAt`),
      "siteName" in source.value
        ? string(source.value.siteName, `${path}.sourceInfo.siteName`)
        : undefined,
    ])
      if (valueIssue) return err(valueIssue);
    issue = attributes(
      candidate.value.normalizedAttributes,
      candidate.value.category as string,
      `${path}.normalizedAttributes`,
    );
    if (issue) return err(issue);
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
  return ok(input as LocalDataRoot);
};

export const schemaValidator: SchemaValidator = {
  validateRoot: (input) => validateRootAt(input),
  validateReplacement: (input) => validateRootAt(input),
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
