/**
 * Shared primitive schemas and the plain strict object rule.
 *
 * Every acceptance boundary here mirrors an existing hand-written predicate so
 * that migrating an owner to a schema cannot silently widen or narrow what the
 * product already accepts. Nothing in this module knows business meaning: an
 * owner attaches its own failure vocabulary with `tagged()`, and the shared
 * layer carries that tag as an opaque string.
 */
import type { Result } from "../result.js";
import { type SchemaNode, type SchemaOutputOf, z } from "./zod-mini.js";

/** Owner-declared failure tag attached to a schema node. */
export type SchemaFailureTag = string;

type SchemaScalar = string | number | boolean | bigint | symbol | null;

/**
 * `plainObject` rejects a key that is present with an `undefined` value, so an
 * optional key in a decoded value is exact-optional. The vendor infers
 * `key?: T | undefined` instead, which is not assignable to the existing
 * public types under `exactOptionalPropertyTypes`; this restores the fact the
 * runtime already guarantees.
 */
type ExactOptional<T> = T extends SchemaScalar | undefined
  ? T
  : T extends readonly (infer Element)[]
    ? readonly ExactOptional<Element>[]
    : T extends object
      ? {
          [K in keyof T as undefined extends T[K] ? never : K]: ExactOptional<
            T[K]
          >;
        } & {
          [K in keyof T as undefined extends T[K] ? K : never]?: ExactOptional<
            Exclude<T[K], undefined>
          >;
        }
      : T;

/** Decoded value type of a shared schema, as owners see it. */
export type SchemaOutput<S extends SchemaNode> = ExactOptional<
  SchemaOutputOf<S>
>;

/** Contract every owner boundary exposes once its schema is in place. */
export interface SchemaDecoder<T, E> {
  decode(input: unknown, basePath?: string): Result<T, E>;
}

/**
 * Tags travel as the vendor issue message because that is the only per-node
 * channel the parser preserves. The prefixes keep owner tags and shared
 * structural failures distinguishable from vendor default messages.
 */
export const TAG_MESSAGE_PREFIX = "tag:";
export const STRUCTURAL_MESSAGE_PREFIX = "structural:";

/** Shape failures the shared layer reports without an owner tag. */
export const STRUCTURAL_ISSUES = {
  notObject: "not_object",
  unsafeObject: "unsafe_object",
  missingKey: "missing_key",
  unexpectedKey: "unexpected_key",
  undefinedValue: "undefined_value",
} as const;

const tagRegistry = new WeakMap<object, SchemaFailureTag>();

/**
 * Wraps a schema node so that its own failures carry a stable owner-side tag.
 * The vendor node is cloned, so the untagged original stays reusable.
 */
export const tagged = <S extends SchemaNode>(
  schema: S,
  tag: SchemaFailureTag,
): S => {
  const message = `${TAG_MESSAGE_PREFIX}${tag}`;
  const clone = z.clone(schema, { ...schema._zod.def, error: () => message });
  tagRegistry.set(clone, tag);
  return clone;
};

/**
 * Marks a shape entry as allowed to be absent. Use this instead of
 * `z.optional` so that the owner tag stays reachable when the key is present
 * with an `undefined` value, which the shared object rule rejects.
 */
export const optionalField = <S extends SchemaNode>(schema: S) => {
  const optional = z.optional(schema);
  const tag = tagRegistry.get(schema);
  if (tag !== undefined) tagRegistry.set(optional, tag);
  return optional;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID_PATTERN.test(value);

const isUtcTimestamp = (value: unknown): value is string => {
  if (typeof value !== "string" || !UTC_PATTERN.test(value)) return false;
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString().replace(".000Z", "Z") ===
      value.replace(".000Z", "Z")
  );
};

const isHttpUrl = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

/*
 * The primitives are factories, not constants, so an owner can name the branded
 * public type it is decoding into (`uuid<ProjectId>()`). Owners then satisfy
 * their existing contracts without a single unchecked cast, and the acceptance
 * boundary still comes from one shared predicate.
 */

/** RFC 4122 version 1-8 identifier, matching the foundation UUID predicate. */
export const uuid = <T extends string = string>() => z.custom<T>(isUuid);

/** `YYYY-MM-DDTHH:MM:SS(.mmm)Z` that round-trips through `Date`. */
export const utcTimestamp = <T extends string = string>() =>
  z.custom<T>(isUtcTimestamp);

/** Absolute `http:` or `https:` URL. */
export const httpUrl = <T extends string = string>() => z.custom<T>(isHttpUrl);

/** Non-negative safe integer, used for aggregate revisions and generations. */
export const revision = <T extends number = number>() =>
  z.custom<T>((value) => Number.isSafeInteger(value) && (value as number) >= 0);

/** Safe integer strictly greater than zero. */
export const positiveInteger = <T extends number = number>() =>
  z.custom<T>((value) => Number.isSafeInteger(value) && (value as number) > 0);

/** Plain string with no coercion. */
export const safeString = <T extends string = string>() =>
  z.custom<T>((value) => typeof value === "string");

/** Plain boolean with no coercion. */
export const safeBoolean = () =>
  z.custom<boolean>((value) => typeof value === "boolean");

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  return true;
};

const hasUnsafeShape = (value: Record<string, unknown>): boolean => {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return true;
  return Object.getOwnPropertySymbols(value).some((symbol) =>
    Object.prototype.propertyIsEnumerable.call(value, symbol),
  );
};

const structural = (issue: string) => `${STRUCTURAL_MESSAGE_PREFIX}${issue}`;

const isOptionalSchema = (schema: SchemaNode): boolean =>
  schema._zod.def.type === "optional";

const taggedMessage = (
  tag: SchemaFailureTag | undefined,
  fallbackIssue: string,
): string =>
  tag === undefined ? structural(fallbackIssue) : `${TAG_MESSAGE_PREFIX}${tag}`;

const registeredTag = (schema: unknown): SchemaFailureTag | undefined =>
  typeof schema === "object" && schema !== null
    ? tagRegistry.get(schema)
    : undefined;

export interface PlainObjectOptions {
  /** Failure tag for input that is not an object, or is an array. */
  readonly nonObjectTag?: SchemaFailureTag;
  /** Failure tag for a forbidden prototype or an enumerable symbol key. */
  readonly unsafeObjectTag?: SchemaFailureTag;
}

/**
 * Strict plain object: every allowed key is declared, unknown keys are
 * rejected instead of stripped, and the whole structural vocabulary (array,
 * missing key, unknown key, forbidden prototype, enumerable symbol) is decided
 * before any field value is read. That ordering is what keeps error codes and
 * canonical paths identical to the hand-written validators.
 */
export const plainObject = <Shape extends Parameters<typeof z.strictObject>[0]>(
  shape: Shape,
  options: PlainObjectOptions = {},
) => {
  const entries = Object.entries(shape);
  const optionalKeys = new Set(
    entries
      .filter(([, schema]) => isOptionalSchema(schema))
      .map(([key]) => key),
  );
  const allowedKeys = new Set(entries.map(([key]) => key));
  const gate = z.unknown().check(
    z.superRefine((value, ctx) => {
      const reject = (message: string, path: readonly string[] = []) => {
        ctx.addIssue({ code: "custom", message, path: [...path], abort: true });
      };
      if (!isPlainRecord(value))
        return reject(
          taggedMessage(options.nonObjectTag, STRUCTURAL_ISSUES.notObject),
        );
      if (hasUnsafeShape(value))
        return reject(
          taggedMessage(
            options.unsafeObjectTag,
            STRUCTURAL_ISSUES.unsafeObject,
          ),
        );
      for (const [key] of entries)
        if (!optionalKeys.has(key) && !(key in value))
          return reject(structural(STRUCTURAL_ISSUES.missingKey), [key]);
      for (const key of Object.keys(value))
        if (!allowedKeys.has(key))
          return reject(structural(STRUCTURAL_ISSUES.unexpectedKey), [key]);
      for (const [key, schema] of entries)
        if (key in value && value[key] === undefined)
          return reject(
            taggedMessage(
              registeredTag(schema),
              STRUCTURAL_ISSUES.undefinedValue,
            ),
            [key],
          );
      return undefined;
    }),
  );
  return z.pipe(gate, z.strictObject(shape));
};
