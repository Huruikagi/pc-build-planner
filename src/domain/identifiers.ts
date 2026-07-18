declare const uuidBrand: unique symbol;
declare const requestIdBrand: unique symbol;
declare const utcTimestampBrand: unique symbol;
declare const revisionBrand: unique symbol;

export type Uuid = string & { readonly [uuidBrand]: "Uuid" };
export type RequestId = Uuid & { readonly [requestIdBrand]: "RequestId" };
export type UtcTimestamp = string & {
  readonly [utcTimestampBrand]: "UtcTimestamp";
};
export type Revision = number & { readonly [revisionBrand]: "Revision" };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export const isUuid = (value: unknown): value is Uuid =>
  typeof value === "string" && UUID_PATTERN.test(value);

export const createUuid = (): Uuid => crypto.randomUUID() as Uuid;

export const isRequestId = (value: unknown): value is RequestId =>
  isUuid(value);

export const createRequestId = (): RequestId => createUuid() as RequestId;

export const isUtcTimestamp = (value: unknown): value is UtcTimestamp => {
  if (typeof value !== "string" || !UTC_TIMESTAMP_PATTERN.test(value)) {
    return false;
  }

  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString().replace(".000Z", "Z") ===
      value.replace(".000Z", "Z")
  );
};

export const createUtcTimestamp = (date: Date = new Date()): UtcTimestamp =>
  date.toISOString() as UtcTimestamp;

export const isRevision = (value: unknown): value is Revision =>
  Number.isSafeInteger(value) && (value as number) >= 0;

export const createRevision = (value: number): Revision => {
  if (!isRevision(value)) {
    throw new RangeError("revision must be a non-negative safe integer");
  }
  return value;
};
