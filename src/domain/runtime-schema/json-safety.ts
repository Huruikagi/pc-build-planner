/**
 * Recursive JSON-safety inspection for untrusted payloads.
 *
 * This runs before any shape schema: a payload that is not plain JSON, that
 * cycles, or that smuggles page content must be rejected as a whole, at the
 * first path where the violation is decided. Issues carry a kind and a path
 * only — never the offending value — so that error reporting and logs cannot
 * leak captured page data.
 */
import type { JsonValue } from "../normalized-attributes.js";
import { err, ok, type Result } from "../result.js";

export type JsonSafetyIssueKind =
  | "not-json"
  | "cycle"
  | "forbidden-key"
  | "embedded-content"
  | "unsafe-object";

export interface JsonSafetyIssue {
  readonly kind: JsonSafetyIssueKind;
  readonly path: string;
}

const FORBIDDEN_KEY_PATTERN =
  /(?:^|[-_])(html|image|images|image-data|imageData|binary|blob)(?:$|[-_])/i;
const RAW_HTML_PATTERN = /<(?:!doctype\s+html|!--|\/?[a-z][^>]*>)/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasUnsafeShape = (value: Record<string, unknown>): boolean => {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return true;
  return Object.getOwnPropertySymbols(value).some((symbol) =>
    Object.prototype.propertyIsEnumerable.call(value, symbol),
  );
};

const isJsonScalar = (value: unknown): boolean =>
  value === null ||
  typeof value === "string" ||
  typeof value === "boolean" ||
  (typeof value === "number" && Number.isFinite(value));

const inspect = (
  value: unknown,
  path: string,
  ancestors: ReadonlySet<object>,
): JsonSafetyIssue | undefined => {
  if (
    typeof value === "string" &&
    (/^data:/i.test(value) || RAW_HTML_PATTERN.test(value))
  )
    return { kind: "embedded-content", path };
  const traversable = Array.isArray(value) || isRecord(value);
  if (!traversable)
    return isJsonScalar(value) ? undefined : { kind: "not-json", path };
  if (ancestors.has(value)) return { kind: "cycle", path };
  const descendants = new Set([...ancestors, value]);
  if (Array.isArray(value))
    for (const [index, item] of value.entries()) {
      const issue = inspect(item, `${path}[${index}]`, descendants);
      if (issue) return issue;
    }
  else {
    if (hasUnsafeShape(value)) return { kind: "unsafe-object", path };
    // Own enumerable string keys, in insertion order, so the first reported
    // violation is stable for identical inputs.
    for (const key of Object.keys(value)) {
      const itemPath = `${path}.${key}`;
      if (FORBIDDEN_KEY_PATTERN.test(key))
        return { kind: "forbidden-key", path: itemPath };
      const issue = inspect(value[key], itemPath, descendants);
      if (issue) return issue;
    }
  }
  return undefined;
};

/**
 * Returns the input unchanged when it is JSON-safe, otherwise the first
 * violation with its canonical path.
 */
export const inspectJsonSafety = (
  input: unknown,
  basePath = "$",
): Result<JsonValue, JsonSafetyIssue> => {
  const issue = inspect(input, basePath, new Set());
  return issue === undefined ? ok(input as JsonValue) : err(issue);
};
