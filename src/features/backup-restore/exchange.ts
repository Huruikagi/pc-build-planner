import type {
  CandidatePart,
  CandidateSource,
  CandidateSourceId,
  CandidateSourceState,
  CurrentBuild,
  LocalDataRoot,
  MaintenanceGeneration,
  Project,
  Result,
  Revision,
  UtcTimestamp,
} from "../../domain/public.js";
import {
  err,
  isJsonValue,
  ok,
  validateCandidatePartValue,
} from "../../domain/public.js";
import { CURRENT_SCHEMA_VERSION } from "../../persistence/public.js";
import { decodeBackupEnvelopeShape } from "./backup-schema.js";
import type {
  BackupCandidatePart,
  BackupCurrentBuild,
  BackupProject,
  CurrentBackupEnvelope,
  ExchangeMappingError,
  ExchangeValidationError,
  ExchangeVersionError,
} from "./contracts.js";
import {
  BACKUP_PRODUCT_ID,
  CURRENT_BACKUP_FORMAT_VERSION,
} from "./contracts.js";

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null) &&
  !Object.getOwnPropertySymbols(value).some((symbol) =>
    Object.prototype.propertyIsEnumerable.call(value, symbol),
  );

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
const validatePart = (
  value: unknown,
  path: string,
): Result<BackupCandidatePart, ExchangeValidationError> => {
  const validated = validateCandidatePartValue(value, path);
  if (!validated.ok)
    return validated.error.code === "duplicate-id" ||
      validated.error.code === "missing-reference"
      ? referenceFail(validated.error.path)
      : structureFail(validated.error.path);
  return ok(validated.value as BackupCandidatePart);
};

const validateEnvelopeStructure = (
  input: unknown,
): Result<CurrentBackupEnvelope, ExchangeValidationError> => {
  const envelope = decodeBackupEnvelopeShape(input);
  if (!envelope.ok) return envelope;
  const data = envelope.value.data;

  const projectIds = new Set<string>();
  const projects: BackupProject[] = [];
  for (const [index, project] of data.projects.entries()) {
    const path = `$.data.projects[${index}]`;
    if (projectIds.has(project.id)) return referenceFail(`${path}.id`);
    projectIds.add(project.id);
    projects.push(project);
  }

  const candidateOwners = new Map<string, string>();
  const parts: BackupCandidatePart[] = [];
  for (const [index, item] of data.parts.entries()) {
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
  for (const [index, build] of data.currentBuilds.entries()) {
    const path = `$.data.currentBuilds[${index}]`;
    if (!projectIds.has(build.projectId))
      return referenceFail(`${path}.projectId`);
    if (buildIds.has(build.id)) return referenceFail(`${path}.id`);
    buildIds.add(build.id);
    for (const [itemIndex, buildItem] of build.items.entries()) {
      if (candidateOwners.get(buildItem.candidatePartId) !== build.projectId)
        return referenceFail(`${path}.items[${itemIndex}].candidatePartId`);
    }
    currentBuilds.push(build);
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

const hasLegacyCandidateShape = (input: unknown): boolean => {
  if (!isPlainRecord(input) || !isPlainRecord(input.data)) return false;
  if (!Array.isArray(input.data.parts)) return false;
  return input.data.parts.some(
    (part) =>
      isPlainRecord(part) &&
      (!("sources" in part) ||
        "sourceInfo" in part ||
        (isPlainRecord(part.product) && "price" in part.product)),
  );
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
    sourceVersion === CURRENT_BACKUP_FORMAT_VERSION &&
    hasLegacyCandidateShape(input)
  )
    return err({ code: "unsupported-version", path: "$.formatVersion" });
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

const projectToBackup = (project: Project): BackupProject => ({
  id: project.id,
  name: project.name,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
});

const partToBackup = (part: CandidatePart): BackupCandidatePart => ({
  id: part.id,
  projectId: part.projectId,
  category: part.category,
  product: part.product,
  sources: part.sources,
  ...(part.primarySourceId === undefined
    ? {}
    : { primarySourceId: part.primarySourceId }),
  ...(part.sourceSnapshot === undefined
    ? {}
    : { sourceSnapshot: part.sourceSnapshot }),
  normalizedAttributes: part.normalizedAttributes,
  createdAt: part.createdAt,
  updatedAt: part.updatedAt,
});

const buildToBackup = (build: CurrentBuild): BackupCurrentBuild => ({
  id: build.id,
  projectId: build.projectId,
  items: build.items.map((item) => ({
    candidatePartId: item.candidatePartId,
    quantity: item.quantity,
  })),
  updatedAt: build.updatedAt,
});

/** 検証済み保存rootを現行交換形式Envelopeへ写像する。保存schemaVersionは含めない。 */
export const mapRootToBackupEnvelope = (
  root: LocalDataRoot,
  createdAt: UtcTimestamp,
): CurrentBackupEnvelope => ({
  product: BACKUP_PRODUCT_ID,
  formatVersion: CURRENT_BACKUP_FORMAT_VERSION,
  createdAt,
  data: {
    projects: root.projects.map(projectToBackup),
    parts: root.candidateParts.map(partToBackup),
    currentBuilds: root.currentBuilds.map(buildToBackup),
  },
});

const projectFromBackup = (project: BackupProject): Project => ({
  id: project.id,
  name: project.name,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
});

const partFromBackup = (part: BackupCandidatePart): CandidatePart => {
  const sourceState: CandidateSourceState =
    part.sources.length === 0
      ? { sources: [] }
      : {
          sources: part.sources as readonly [
            CandidateSource,
            ...CandidateSource[],
          ],
          primarySourceId: part.primarySourceId as CandidateSourceId,
        };
  return {
    id: part.id,
    projectId: part.projectId,
    category: part.category,
    product: part.product,
    ...sourceState,
    ...(part.sourceSnapshot === undefined
      ? {}
      : { sourceSnapshot: part.sourceSnapshot }),
    normalizedAttributes: part.normalizedAttributes,
    createdAt: part.createdAt,
    updatedAt: part.updatedAt,
  };
};

const buildFromBackup = (build: BackupCurrentBuild): CurrentBuild => ({
  id: build.id,
  projectId: build.projectId,
  items: build.items.map((item) => ({
    candidatePartId: item.candidatePartId,
    quantity: item.quantity,
  })),
  updatedAt: build.updatedAt,
});

/**
 * 検証済みEnvelopeから現行保存スキーマ版の保存root候補を構築する。
 * schemaVersion・revision・maintenance・requestDedupeは交換データから信頼せず、
 * Foundationのassess/replace側で再確定される前提のplaceholder値へ一律揃える。
 * この候補はFoundation検証へ渡す前提であり、feature側でschema検証・容量判定を重複実行しない。
 */
export const mapBackupEnvelopeToRoot = (
  envelope: CurrentBackupEnvelope,
): Result<LocalDataRoot, ExchangeMappingError> =>
  ok({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    revision: 0 as Revision,
    projects: envelope.data.projects.map(projectFromBackup),
    candidateParts: envelope.data.parts.map(partFromBackup),
    currentBuilds: envelope.data.currentBuilds.map(buildFromBackup),
    requestDedupe: [],
    maintenance: { generation: 0 as MaintenanceGeneration, active: false },
  } as LocalDataRoot);

export interface ExchangeMapper {
  fromRoot(root: LocalDataRoot, createdAt: UtcTimestamp): CurrentBackupEnvelope;
  toRoot(
    envelope: CurrentBackupEnvelope,
  ): Result<LocalDataRoot, ExchangeMappingError>;
}

export const exchangeMapper: ExchangeMapper = {
  fromRoot: mapRootToBackupEnvelope,
  toRoot: mapBackupEnvelopeToRoot,
};
