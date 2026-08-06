/**
 * Owner-local runtime schemas for the local data foundation.
 *
 * The shared kernel supplies primitives, the strict plain-object rule and the
 * issue adapter; the meaning of every shape below belongs to this boundary.
 * Each schema node carries the foundation's own `ValidationErrorCode` as its
 * failure tag, so the error vocabulary survives the move to declarative shapes
 * without any owner reading a vendor issue code or a path pattern.
 *
 * Fragments are deliberately not fused into one root schema: the aggregate
 * order (projects, then candidates, then builds, then dedupe, then
 * maintenance) and the semantic passes that need it live in `validation.ts`,
 * which drives these fragments in exactly the order the hand-written validator
 * used.
 */
import type { RequestId, Revision, UtcTimestamp } from "./identifiers.js";
import type {
  CandidatePartId,
  CandidateSourceId,
  CandidateSourceKind,
  CurrentBuildId,
  MaintenanceGeneration,
  MaintenanceOwnerId,
  PositiveInteger,
  ProjectId,
} from "./model.js";
import type { PartCategory } from "./normalized-attributes.js";
import { PART_CATEGORIES } from "./normalized-attributes.js";
import type { SchemaNode } from "./runtime-schema/public.js";
import {
  httpUrl,
  optionalField,
  plainObject,
  positiveInteger,
  revision,
  safeBoolean,
  safeString,
  tagged,
  utcTimestamp,
  uuid,
  z,
} from "./runtime-schema/public.js";

/**
 * A value that is not a plain object was reported as a missing field by the
 * hand-written `object()` helper, and a poisoned prototype or an enumerable
 * symbol key as a forbidden payload. Every foundation object keeps that pair.
 */
const objectTags = {
  nonObjectTag: "missing-field",
  unsafeObjectTag: "forbidden-payload",
} as const;

/*
 * Local primitives: acceptance sets the shared kernel deliberately does not
 * own, because they are only meaningful inside this aggregate. Each is a
 * single node so that its failure is reported at the node's own path, exactly
 * as the predicate it replaces did.
 */

const nullableString = () =>
  z.custom<string | null>(
    (value) => value === null || typeof value === "string",
  );

const finiteNumber = () =>
  z.custom<number>(
    (value) => typeof value === "number" && Number.isFinite(value),
  );

/** Whole-array check: a non-string element fails the array, not the element. */
const stringArray = () =>
  z.custom<readonly string[]>(
    (value) =>
      Array.isArray(value) && value.every((item) => typeof item === "string"),
  );

const unknownArray = () =>
  z.custom<readonly unknown[]>((value) => Array.isArray(value));

const partCategory = () =>
  z.custom<PartCategory>((value) =>
    PART_CATEGORIES.includes(value as PartCategory),
  );

const candidateSourceKind = () =>
  z.custom<CandidateSourceKind>(
    (value) => value === "retail" || value === "manufacturer",
  );

const projectIdSchema = tagged(uuid<ProjectId>(), "invalid-uuid");
const timestampSchema = tagged(
  utcTimestamp<UtcTimestamp>(),
  "invalid-utc-timestamp",
);
const revisionSchema = tagged(revision<Revision>(), "invalid-integer");

/** Reused where the primary reference is checked outside its own object. */
export const candidateSourceIdSchema = tagged(
  uuid<CandidateSourceId>(),
  "invalid-uuid",
);

/*
 * Candidate product and attribute values.
 */

const sourcedValue = <S extends SchemaNode>(confirmed: S) =>
  plainObject(
    {
      original: tagged(nullableString(), "invalid-string"),
      confirmed: optionalField(confirmed),
    },
    objectTags,
  );

const sourcedString = sourcedValue(tagged(safeString(), "invalid-string"));
const sourcedStrings = sourcedValue(tagged(stringArray(), "invalid-array"));
const sourcedMoney = sourcedValue(
  plainObject(
    {
      amount: tagged(finiteNumber(), "invalid-integer"),
      currency: tagged(safeString(), "invalid-string"),
    },
    objectTags,
  ),
);

const productSchema = plainObject(
  {
    name: optionalField(sourcedString),
    manufacturer: optionalField(sourcedString),
    modelNumber: optionalField(sourcedString),
    notes: optionalField(sourcedString),
  },
  objectTags,
);

/** Free-form original notation per field name; only strings and nulls. */
const sourceSnapshotSchema = tagged(
  z.record(z.string(), tagged(nullableString(), "invalid-string")),
  "missing-field",
);

const categoryLiteral = (category: PartCategory) =>
  tagged(z.literal(category), "category-mismatch");

/**
 * Attribute shapes per category. The allowed field set is the category's own
 * contract, so each category gets its own strict object rather than a shared
 * bag with conditional keys.
 */
const ATTRIBUTE_SCHEMAS: Readonly<Record<PartCategory, SchemaNode>> = {
  cpu: plainObject(
    { category: categoryLiteral("cpu"), socket: optionalField(sourcedString) },
    objectTags,
  ),
  "cpu-cooler": plainObject(
    {
      category: categoryLiteral("cpu-cooler"),
      supportedSockets: optionalField(sourcedStrings),
    },
    objectTags,
  ),
  motherboard: plainObject(
    {
      category: categoryLiteral("motherboard"),
      socket: optionalField(sourcedString),
      memoryStandard: optionalField(sourcedString),
      formFactor: optionalField(sourcedString),
    },
    objectTags,
  ),
  memory: plainObject(
    {
      category: categoryLiteral("memory"),
      memoryStandard: optionalField(sourcedString),
    },
    objectTags,
  ),
  gpu: plainObject({ category: categoryLiteral("gpu") }, objectTags),
  storage: plainObject({ category: categoryLiteral("storage") }, objectTags),
  "power-supply": plainObject(
    {
      category: categoryLiteral("power-supply"),
      formFactor: optionalField(sourcedString),
    },
    objectTags,
  ),
  case: plainObject(
    {
      category: categoryLiteral("case"),
      supportedMotherboardFormFactors: optionalField(sourcedStrings),
      supportedPowerSupplyFormFactors: optionalField(sourcedStrings),
    },
    objectTags,
  ),
  "case-fan": plainObject(
    { category: categoryLiteral("case-fan") },
    objectTags,
  ),
  "expansion-card": plainObject(
    { category: categoryLiteral("expansion-card") },
    objectTags,
  ),
  other: plainObject({ category: categoryLiteral("other") }, objectTags),
  uncategorized: plainObject(
    { category: categoryLiteral("uncategorized") },
    objectTags,
  ),
};

export const attributesSchemaFor = (category: PartCategory): SchemaNode =>
  ATTRIBUTE_SCHEMAS[category];

/*
 * Candidate shapes.
 *
 * `sources`, `primarySourceId` and `normalizedAttributes` stay `unknown` here.
 * Their contracts are conditional on sibling values (the source list decides
 * whether a primary reference is required; the category decides the attribute
 * shape), which is an ordered semantic pass, not a shape.
 */

const candidateContentShape = {
  category: tagged(partCategory(), "category-mismatch"),
  product: productSchema,
  sources: z.unknown(),
  normalizedAttributes: z.unknown(),
  primarySourceId: optionalField(z.unknown()),
  sourceSnapshot: optionalField(sourceSnapshotSchema),
};

/** Saved candidate content: project is resolved, sources are required. */
export const candidateContentSchema = plainObject(
  {
    projectId: projectIdSchema,
    category: candidateContentShape.category,
    product: candidateContentShape.product,
    sources: candidateContentShape.sources,
    normalizedAttributes: candidateContentShape.normalizedAttributes,
    primarySourceId: candidateContentShape.primarySourceId,
    sourceSnapshot: candidateContentShape.sourceSnapshot,
  },
  objectTags,
);

/** Editing draft: no project yet, and a candidate may carry no source at all. */
export const candidateDraftSchema = plainObject(
  {
    category: candidateContentShape.category,
    product: candidateContentShape.product,
    normalizedAttributes: candidateContentShape.normalizedAttributes,
    sources: optionalField(z.unknown()),
    primarySourceId: candidateContentShape.primarySourceId,
    sourceSnapshot: candidateContentShape.sourceSnapshot,
  },
  objectTags,
);

/** Stored candidate: content plus identity and timestamps. */
export const candidatePartValueSchema = plainObject(
  {
    id: tagged(uuid<CandidatePartId>(), "invalid-uuid"),
    projectId: projectIdSchema,
    category: candidateContentShape.category,
    product: candidateContentShape.product,
    sources: candidateContentShape.sources,
    normalizedAttributes: candidateContentShape.normalizedAttributes,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    primarySourceId: candidateContentShape.primarySourceId,
    sourceSnapshot: candidateContentShape.sourceSnapshot,
  },
  objectTags,
);

export const candidateSourceSchema = plainObject(
  {
    id: candidateSourceIdSchema,
    pageUrl: optionalField(tagged(httpUrl(), "invalid-url")),
    siteName: optionalField(tagged(safeString(), "invalid-string")),
    capturedAt: optionalField(timestampSchema),
    price: optionalField(sourcedMoney),
    kind: optionalField(tagged(candidateSourceKind(), "invalid-string")),
  },
  objectTags,
);

/*
 * Root fragments.
 */

export const projectSchema = plainObject(
  {
    id: projectIdSchema,
    name: tagged(safeString(), "invalid-string"),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  },
  objectTags,
);

export const buildItemSchema = plainObject(
  {
    candidatePartId: tagged(uuid<CandidatePartId>(), "invalid-uuid"),
    quantity: tagged(
      positiveInteger<PositiveInteger>(),
      "invalid-positive-integer",
    ),
  },
  objectTags,
);

export const currentBuildSchema = plainObject(
  {
    id: tagged(uuid<CurrentBuildId>(), "invalid-uuid"),
    projectId: projectIdSchema,
    items: tagged(unknownArray(), "invalid-array"),
    updatedAt: timestampSchema,
  },
  objectTags,
);

export const requestDedupeSchema = plainObject(
  {
    requestId: tagged(uuid<RequestId>(), "invalid-uuid"),
    payloadDigest: tagged(safeString(), "invalid-string"),
    committedRevision: revisionSchema,
  },
  objectTags,
);

const maintenanceGeneration = tagged(
  revision<MaintenanceGeneration>(),
  "invalid-integer",
);

/** Decides `active` before the fields it governs, as the predecessor did. */
export const maintenanceEnvelopeSchema = plainObject(
  {
    generation: maintenanceGeneration,
    active: tagged(safeBoolean(), "invalid-boolean"),
    ownerId: optionalField(z.unknown()),
    leaseExpiresAt: optionalField(z.unknown()),
  },
  objectTags,
);

export const activeMaintenanceSchema = plainObject(
  {
    generation: maintenanceGeneration,
    active: tagged(z.literal(true), "invalid-boolean"),
    ownerId: tagged(uuid<MaintenanceOwnerId>(), "invalid-uuid"),
    leaseExpiresAt: timestampSchema,
  },
  objectTags,
);

export const inactiveMaintenanceSchema = plainObject(
  {
    generation: maintenanceGeneration,
    active: tagged(z.literal(false), "invalid-boolean"),
  },
  objectTags,
);

/**
 * Root envelope: version, revision and the collection slots. Item shapes and
 * every cross-item rule are checked afterwards, collection by collection.
 */
export const rootEnvelopeSchema = plainObject(
  {
    schemaVersion: tagged(z.literal(1), "unsupported-schema"),
    revision: revisionSchema,
    projects: tagged(unknownArray(), "invalid-array"),
    candidateParts: tagged(unknownArray(), "invalid-array"),
    currentBuilds: tagged(unknownArray(), "invalid-array"),
    requestDedupe: tagged(unknownArray(), "invalid-array"),
    maintenance: z.unknown(),
  },
  objectTags,
);

/*
 * Command shapes. The envelope fixes the allowed key set before `kind` selects
 * the command contract, so an unknown field is reported before a kind-specific
 * requirement is.
 */

export const commandEnvelopeSchema = plainObject(
  {
    kind: tagged(safeString(), "invalid-string"),
    requestId: optionalField(z.unknown()),
    expectedRevision: optionalField(z.unknown()),
    proposedRoot: optionalField(z.unknown()),
  },
  objectTags,
);

export const queryCommandSchema = plainObject(
  { kind: tagged(z.literal("query-root"), "invalid-string") },
  objectTags,
);

export const mutateCommandSchema = plainObject(
  {
    kind: tagged(z.literal("mutate-root"), "invalid-string"),
    requestId: tagged(uuid<RequestId>(), "invalid-uuid"),
    expectedRevision: revisionSchema,
    proposedRoot: z.unknown(),
  },
  objectTags,
);
