import type { PartCategory, Result } from "../../domain/public.js";
import {
  err,
  isJsonValue,
  isUtcTimestamp,
  isUuid,
  ok,
  PART_CATEGORIES,
} from "../../domain/public.js";
import type {
  BackupCandidatePart,
  BackupCurrentBuild,
  BackupProject,
  CurrentBackupEnvelope,
  ExchangeValidationError,
  ExchangeVersionError,
} from "./contracts.js";
import {
  BACKUP_PRODUCT_ID,
  CURRENT_BACKUP_FORMAT_VERSION,
} from "./contracts.js";

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const FORBIDDEN_KEY_PATTERN =
  /(?:^|[-_])(html|image|images|image-data|imageData|binary|blob)(?:$|[-_])/i;
const RAW_HTML_PATTERN = /<(?:!doctype\s+html|!--|\/?[a-z][^>]*>)/i;

/** JSON object自身のプロパティだけを辿り、危険な余剰内容の位置をpathで返す。値そのものは返さない。 */
const scanForbiddenContent = (
  value: unknown,
  path: string,
  ancestors: ReadonlySet<object>,
): string | undefined => {
  if (
    typeof value === "string" &&
    (/^data:/i.test(value) || RAW_HTML_PATTERN.test(value))
  )
    return path;
  const traversable = Array.isArray(value) || isPlainRecord(value);
  if (traversable && ancestors.has(value as object)) return path;
  const nextAncestors = traversable
    ? new Set([...ancestors, value as object])
    : ancestors;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = scanForbiddenContent(
        item,
        `${path}[${index}]`,
        nextAncestors,
      );
      if (found !== undefined) return found;
    }
  } else if (isPlainRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      const itemPath = `${path}.${key}`;
      if (FORBIDDEN_KEY_PATTERN.test(key)) return itemPath;
      const found = scanForbiddenContent(item, itemPath, nextAncestors);
      if (found !== undefined) return found;
    }
  }
  return undefined;
};

const structureFail = (path: string): Result<never, ExchangeValidationError> =>
  err({ code: "invalid-structure", path });
const referenceFail = (path: string): Result<never, ExchangeValidationError> =>
  err({ code: "invalid-reference", path });

/** 必須・許容keyだけを own property から読み、余剰・欠落を一律invalid-structureとして拒否する。 */
const object = (
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Result<Record<string, unknown>, ExchangeValidationError> => {
  if (!isPlainRecord(value)) return structureFail(path);
  for (const key of required)
    if (!(key in value)) return structureFail(`${path}.${key}`);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value))
    if (!allowed.has(key)) return structureFail(`${path}.${key}`);
  return ok(value);
};

const validateProject = (
  value: unknown,
  path: string,
): Result<BackupProject, ExchangeValidationError> => {
  const project = object(value, path, ["id", "name", "createdAt", "updatedAt"]);
  if (!project.ok) return project;
  if (!isUuid(project.value.id)) return structureFail(`${path}.id`);
  if (typeof project.value.name !== "string")
    return structureFail(`${path}.name`);
  if (!isUtcTimestamp(project.value.createdAt))
    return structureFail(`${path}.createdAt`);
  if (!isUtcTimestamp(project.value.updatedAt))
    return structureFail(`${path}.updatedAt`);
  return ok(value as BackupProject);
};

const validatePart = (
  value: unknown,
  path: string,
): Result<BackupCandidatePart, ExchangeValidationError> => {
  const part = object(
    value,
    path,
    [
      "id",
      "projectId",
      "category",
      "product",
      "normalizedAttributes",
      "createdAt",
      "updatedAt",
    ],
    ["sourceInfo", "sourceSnapshot"],
  );
  if (!part.ok) return part;
  if (!isUuid(part.value.id)) return structureFail(`${path}.id`);
  if (!isUuid(part.value.projectId)) return structureFail(`${path}.projectId`);
  if (!PART_CATEGORIES.includes(part.value.category as PartCategory))
    return structureFail(`${path}.category`);
  if (!isPlainRecord(part.value.product))
    return structureFail(`${path}.product`);
  if (!isPlainRecord(part.value.normalizedAttributes))
    return structureFail(`${path}.normalizedAttributes`);
  if (
    (part.value.normalizedAttributes as Record<string, unknown>).category !==
    part.value.category
  )
    return structureFail(`${path}.normalizedAttributes.category`);
  if (!isUtcTimestamp(part.value.createdAt))
    return structureFail(`${path}.createdAt`);
  if (!isUtcTimestamp(part.value.updatedAt))
    return structureFail(`${path}.updatedAt`);
  if ("sourceInfo" in part.value && !isPlainRecord(part.value.sourceInfo))
    return structureFail(`${path}.sourceInfo`);
  if (
    "sourceSnapshot" in part.value &&
    !isPlainRecord(part.value.sourceSnapshot)
  )
    return structureFail(`${path}.sourceSnapshot`);
  return ok(value as BackupCandidatePart);
};

const validateBuildItem = (
  value: unknown,
  path: string,
): Result<
  { readonly candidatePartId: string; readonly quantity: number },
  ExchangeValidationError
> => {
  const item = object(value, path, ["candidatePartId", "quantity"]);
  if (!item.ok) return item;
  if (!isUuid(item.value.candidatePartId))
    return structureFail(`${path}.candidatePartId`);
  if (
    !Number.isSafeInteger(item.value.quantity) ||
    (item.value.quantity as number) <= 0
  )
    return structureFail(`${path}.quantity`);
  return ok(
    item.value as unknown as {
      readonly candidatePartId: string;
      readonly quantity: number;
    },
  );
};

const validateBuild = (
  value: unknown,
  path: string,
): Result<BackupCurrentBuild, ExchangeValidationError> => {
  const build = object(value, path, ["id", "projectId", "items", "updatedAt"]);
  if (!build.ok) return build;
  if (!isUuid(build.value.id)) return structureFail(`${path}.id`);
  if (!isUuid(build.value.projectId)) return structureFail(`${path}.projectId`);
  if (!isUtcTimestamp(build.value.updatedAt))
    return structureFail(`${path}.updatedAt`);
  if (!Array.isArray(build.value.items)) return structureFail(`${path}.items`);
  for (const [index, item] of build.value.items.entries()) {
    const itemResult = validateBuildItem(item, `${path}.items[${index}]`);
    if (!itemResult.ok) return itemResult;
  }
  return ok(value as BackupCurrentBuild);
};

const validateEnvelopeStructure = (
  input: unknown,
): Result<CurrentBackupEnvelope, ExchangeValidationError> => {
  const envelope = object(input, "$", [
    "product",
    "formatVersion",
    "createdAt",
    "data",
  ]);
  if (!envelope.ok) return envelope;
  if (envelope.value.product !== BACKUP_PRODUCT_ID)
    return structureFail("$.product");
  if (envelope.value.formatVersion !== CURRENT_BACKUP_FORMAT_VERSION)
    return structureFail("$.formatVersion");
  if (!isUtcTimestamp(envelope.value.createdAt))
    return structureFail("$.createdAt");

  const data = object(envelope.value.data, "$.data", [
    "projects",
    "parts",
    "currentBuilds",
  ]);
  if (!data.ok) return data;
  if (!Array.isArray(data.value.projects))
    return structureFail("$.data.projects");
  if (!Array.isArray(data.value.parts)) return structureFail("$.data.parts");
  if (!Array.isArray(data.value.currentBuilds))
    return structureFail("$.data.currentBuilds");

  const projectIds = new Set<string>();
  const projects: BackupProject[] = [];
  for (const [index, item] of data.value.projects.entries()) {
    const path = `$.data.projects[${index}]`;
    const project = validateProject(item, path);
    if (!project.ok) return project;
    if (projectIds.has(project.value.id)) return referenceFail(`${path}.id`);
    projectIds.add(project.value.id);
    projects.push(project.value);
  }

  const candidateOwners = new Map<string, string>();
  const parts: BackupCandidatePart[] = [];
  for (const [index, item] of data.value.parts.entries()) {
    const path = `$.data.parts[${index}]`;
    const part = validatePart(item, path);
    if (!part.ok) return part;
    if (!projectIds.has(part.value.projectId))
      return referenceFail(`${path}.projectId`);
    if (candidateOwners.has(part.value.id)) return referenceFail(`${path}.id`);
    candidateOwners.set(part.value.id, part.value.projectId);
    parts.push(part.value);
  }

  const buildIds = new Set<string>();
  const currentBuilds: BackupCurrentBuild[] = [];
  for (const [index, item] of data.value.currentBuilds.entries()) {
    const path = `$.data.currentBuilds[${index}]`;
    const build = validateBuild(item, path);
    if (!build.ok) return build;
    if (!projectIds.has(build.value.projectId))
      return referenceFail(`${path}.projectId`);
    if (buildIds.has(build.value.id)) return referenceFail(`${path}.id`);
    buildIds.add(build.value.id);
    for (const [itemIndex, buildItem] of build.value.items.entries()) {
      if (
        candidateOwners.get(buildItem.candidatePartId) !== build.value.projectId
      )
        return referenceFail(`${path}.items[${itemIndex}].candidatePartId`);
    }
    currentBuilds.push(build.value);
  }

  return ok({
    product: BACKUP_PRODUCT_ID,
    formatVersion: CURRENT_BACKUP_FORMAT_VERSION,
    createdAt: envelope.value.createdAt,
    data: { projects, parts, currentBuilds },
  } as CurrentBackupEnvelope);
};

/** 交換形式の文書はJSON objectそのものである前提。非object・非JSON互換値をnot-jsonとして一律拒否する。 */
export const validateBackupEnvelope = (
  input: unknown,
): Result<CurrentBackupEnvelope, ExchangeValidationError> => {
  if (!isPlainRecord(input)) return err({ code: "not-json", path: "$" });
  if (!isJsonValue(input)) return err({ code: "not-json", path: "$" });
  const forbiddenPath = scanForbiddenContent(input, "$", new Set());
  if (forbiddenPath !== undefined) return structureFail(forbiddenPath);
  return validateEnvelopeStructure(input);
};

export interface ExchangeValidator {
  validate(
    input: unknown,
  ): Result<CurrentBackupEnvelope, ExchangeValidationError>;
}

export const exchangeValidator: ExchangeValidator = {
  validate: validateBackupEnvelope,
};

type ExchangeMigrationStep = (input: Record<string, unknown>) => unknown;

/**
 * 現行形式版1が初出のため、対応旧版は現状存在しない。
 * 将来の形式版追加時、旧sourceVersionをkeyとする連続な純粋変換をここへ登録する。
 */
const MIGRATION_REGISTRY: Readonly<Record<number, ExchangeMigrationStep>> = {};

const readFormatVersion = (input: unknown): number | undefined => {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return undefined;
  const value = Reflect.get(input, "formatVersion");
  return typeof value === "number" ? value : undefined;
};

/** 各移行段階を再検証し、未知・将来・経路欠落版は内容を変換せずunsupported-versionとして拒否する。 */
export const migrateBackupEnvelopeToCurrent = (
  input: unknown,
): Result<
  CurrentBackupEnvelope,
  ExchangeVersionError | ExchangeValidationError
> => {
  const sourceVersion = readFormatVersion(input);
  if (
    sourceVersion === undefined ||
    sourceVersion === CURRENT_BACKUP_FORMAT_VERSION
  )
    return validateBackupEnvelope(input);

  let migrated: unknown = input;
  let version = sourceVersion;
  while (version < CURRENT_BACKUP_FORMAT_VERSION) {
    const step = MIGRATION_REGISTRY[version];
    if (step === undefined)
      return err({ code: "unsupported-version", path: "$.formatVersion" });
    migrated = step(migrated as Record<string, unknown>);
    const revalidated = validateBackupEnvelope(migrated);
    if (!revalidated.ok) return revalidated;
    version += 1;
  }
  if (version !== CURRENT_BACKUP_FORMAT_VERSION)
    return err({ code: "unsupported-version", path: "$.formatVersion" });
  return validateBackupEnvelope(migrated);
};

export interface ExchangeMigration {
  toCurrent(
    input: unknown,
  ): Result<
    CurrentBackupEnvelope,
    ExchangeVersionError | ExchangeValidationError
  >;
}

export const exchangeMigration: ExchangeMigration = {
  toCurrent: migrateBackupEnvelopeToCurrent,
};
