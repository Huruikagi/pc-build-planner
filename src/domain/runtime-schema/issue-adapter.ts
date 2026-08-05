/**
 * Projects vendor parse issues into the only failure view owners may see.
 *
 * The vendor error object, its issue classes and the schema instance stay
 * inside the parse call: what leaves this module is a code, an optional owner
 * tag and plain path segments. Owners map that view onto their own error
 * union, never onto a path string pattern.
 */
import { err, ok, type Result } from "../result.js";
import {
  type SchemaFailureTag,
  type SchemaOutput,
  STRUCTURAL_ISSUES,
  STRUCTURAL_MESSAGE_PREFIX,
  TAG_MESSAGE_PREFIX,
} from "./primitives.js";
import { z } from "./zod-mini.js";

/** Minimal internal projection of a single vendor issue. */
export interface SchemaIssueView {
  readonly code: string;
  /** Owner-declared tag from `tagged()`, absent for structural failures. */
  readonly tag?: SchemaFailureTag;
  readonly path: readonly (string | number)[];
}

/** Owner-supplied mapping from the internal view to the owner error union. */
export interface IssueMappingProfile<E> {
  toError(issue: SchemaIssueView, canonicalPath: string): E;
}

interface VendorIssue {
  readonly code: string;
  readonly message?: string;
  readonly path?: readonly PropertyKey[];
  readonly keys?: readonly string[];
}

const pathSegments = (
  path: readonly PropertyKey[] | undefined,
): (string | number)[] =>
  (path ?? []).flatMap((segment) =>
    typeof segment === "symbol" ? [] : [segment],
  );

/**
 * `$` base, `.property` and `[index]`, identical to the hand-written path
 * helpers. Keys are appended verbatim, matching the existing escape policy.
 */
export const canonicalPath = (
  segments: readonly (string | number)[],
  base = "$",
): string =>
  segments.reduce<string>(
    (path, segment) =>
      typeof segment === "number"
        ? `${path}[${segment}]`
        : `${path}.${segment}`,
    base,
  );

/** Converts one vendor issue into the internal view. */
export const projectIssue = (issue: VendorIssue): SchemaIssueView => {
  const segments = pathSegments(issue.path);
  // An unknown key is reported on the parent node with the key list beside it.
  // Owners expect the offending key in the path, and never a tag: an unknown
  // key is a shape failure, not a value failure of the node it was found on.
  if (issue.code === "unrecognized_keys") {
    const key = issue.keys?.[0];
    return {
      code: STRUCTURAL_ISSUES.unexpectedKey,
      path: key === undefined ? segments : [...segments, key],
    };
  }
  const message = issue.message ?? "";
  if (message.startsWith(STRUCTURAL_MESSAGE_PREFIX))
    return {
      code: message.slice(STRUCTURAL_MESSAGE_PREFIX.length),
      path: segments,
    };
  if (message.startsWith(TAG_MESSAGE_PREFIX))
    return {
      code: issue.code,
      tag: message.slice(TAG_MESSAGE_PREFIX.length),
      path: segments,
    };
  return { code: issue.code, path: segments };
};

/** Converts a whole vendor issue list into internal views, order preserved. */
export const projectIssues = (
  issues: readonly VendorIssue[],
): SchemaIssueView[] => issues.map(projectIssue);

/**
 * Deterministic single-issue selection shared by all owner profiles:
 * shallower failures first, then schema declaration order, then a tagged issue
 * over an untagged one on the very same node. This reproduces the
 * outside-in, first-violation behaviour of the hand-written validators.
 */
export const selectPrimaryIssue = (
  issues: readonly SchemaIssueView[],
): SchemaIssueView => {
  const [first, ...rest] = issues;
  if (first === undefined)
    throw new Error("selectPrimaryIssue requires at least one issue");
  return rest.reduce((best, candidate) => {
    if (candidate.path.length < best.path.length) return candidate;
    if (candidate.path.length > best.path.length) return best;
    const sameNode = canonicalPath(candidate.path) === canonicalPath(best.path);
    return sameNode && candidate.tag !== undefined && best.tag === undefined
      ? candidate
      : best;
  }, first);
};

/**
 * Runs a schema and returns either the typed output or the owner error for the
 * single primary issue. The vendor error never escapes this call.
 */
export const decodeWithProfile = <S extends z.core.$ZodType, E>(
  schema: S,
  input: unknown,
  profile: IssueMappingProfile<E>,
  basePath = "$",
): Result<SchemaOutput<S>, E> => {
  const parsed = z.safeParse(schema, input);
  // The shared object rule has already rejected every present-undefined key,
  // so the decoded value satisfies the exact-optional view of its own type.
  if (parsed.success) return ok(parsed.data as SchemaOutput<S>);
  const issue = selectPrimaryIssue(projectIssues(parsed.error.issues));
  return err(profile.toError(issue, canonicalPath(issue.path, basePath)));
};
