import type { RequestId, Result, UtcTimestamp } from "../../domain/public.js";
import {
  decodeWithProfile,
  optionalField,
  plainObject,
  revision,
  type SchemaOutput,
  safeString,
  tagged,
  utcTimestamp,
  uuid,
  z,
} from "../../domain/runtime-schema/public.js";
import type {
  CaptureCoreField,
  CaptureError,
  CaptureField,
  CaptureFieldRejectionReason,
  CaptureNormalizedValue,
  CaptureResult,
  ExtractionSource,
} from "./contracts.js";
import {
  CAPTURE_CORE_FIELDS,
  isCaptureField,
  isCaptureSourceLabel,
  SITE_NAME_SOURCE_LABEL,
} from "./contracts.js";

const invalid = <T>(schema: T): T =>
  tagged(schema as never, "invalid-payload") as T;
const strictOptions = {
  nonObjectTag: "invalid-payload",
  unsafeObjectTag: "invalid-payload",
} as const;

const extractionSources: ReadonlySet<string> = new Set<ExtractionSource>([
  "json-ld",
  "open-graph",
  "twitter-card",
  "product-meta",
  "heading",
  "breadcrumb",
  "table",
  "definition-list",
  "domain-map",
]);
const rejectionReasons: ReadonlySet<string> =
  new Set<CaptureFieldRejectionReason>([
    "empty",
    "too-long",
    "control-characters",
    "invalid-format",
    "unresolvable",
  ]);
const coreFields: ReadonlySet<string> = new Set(CAPTURE_CORE_FIELDS);

export const captureFieldSchema = invalid(
  z.custom<CaptureField>(isCaptureField),
);
export const captureCoreFieldSchema = invalid(
  z.custom<CaptureCoreField>(
    (value) => typeof value === "string" && coreFields.has(value),
  ),
);
export const captureSourceSchema = invalid(
  z.custom<ExtractionSource>(
    (value) => typeof value === "string" && extractionSources.has(value),
  ),
);
export const captureRejectionReasonSchema = invalid(
  z.custom<CaptureFieldRejectionReason>(
    (value) => typeof value === "string" && rejectionReasons.has(value),
  ),
);

export const captureMoneySchema = plainObject(
  {
    amount: invalid(
      z.custom<number>(
        (value) => typeof value === "number" && Number.isFinite(value),
      ),
    ),
    currency: invalid(safeString()),
  },
  strictOptions,
);

const normalizedValueSchema = invalid(
  z.custom<CaptureNormalizedValue>(
    (value) =>
      typeof value === "string" ||
      z.safeParse(captureMoneySchema, value).success,
  ),
);

export const normalizedCaptureFieldSchema = plainObject(
  {
    field: captureFieldSchema,
    normalizedValue: normalizedValueSchema,
    rawValue: invalid(safeString()),
    source: captureSourceSchema,
    sourceLabel: invalid(z.custom<string>(isCaptureSourceLabel)),
    documentOrder: invalid(revision()),
  },
  strictOptions,
);

/**
 * The optional source display name. Its provenance is pinned to the single
 * allowlisted property so a decoded result cannot claim a site name came from
 * anywhere but `og:site_name`.
 */
export const sourcedSiteNameSchema = plainObject(
  {
    value: invalid(safeString()),
    rawValue: invalid(safeString()),
    source: invalid(z.custom<"open-graph">((value) => value === "open-graph")),
    sourceLabel: invalid(
      z.custom<typeof SITE_NAME_SOURCE_LABEL>(
        (value) => value === SITE_NAME_SOURCE_LABEL,
      ),
    ),
  },
  strictOptions,
);

export const rejectedCaptureFieldSchema = plainObject(
  {
    field: captureFieldSchema,
    reason: captureRejectionReasonSchema,
  },
  strictOptions,
);

export const captureResultSchema = plainObject(
  {
    requestId: invalid(uuid<RequestId>()),
    tabId: invalid(revision()),
    pageUrl: invalid(safeString()),
    capturedAt: invalid(utcTimestamp<UtcTimestamp>()),
    draft: plainObject(
      {
        fields: invalid(z.array(normalizedCaptureFieldSchema)),
        missingCoreFields: invalid(z.array(captureCoreFieldSchema)),
      },
      strictOptions,
    ),
    rejectedFields: invalid(z.array(rejectedCaptureFieldSchema)),
    siteName: optionalField(sourcedSiteNameSchema),
  },
  strictOptions,
);

type CaptureResultSchemaOutput = SchemaOutput<typeof captureResultSchema>;
const captureResultContract = (
  value: CaptureResultSchemaOutput,
): CaptureResult => value;
void captureResultContract;

const profile = {
  toError: (): CaptureError => ({ kind: "invalid-payload" }),
};

export const decodeCaptureResult = (
  input: unknown,
): Result<CaptureResult, CaptureError> =>
  decodeWithProfile(captureResultSchema, input, profile);
