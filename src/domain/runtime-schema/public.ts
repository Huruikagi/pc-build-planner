/**
 * The only entry point owners may import to declare a runtime schema.
 *
 * It exposes the configured vendor namespace, the shared primitives, the
 * JSON-safety inspector and the issue adapter. It deliberately exposes no
 * business schema: every business shape stays inside the boundary that owns
 * it, and cross-feature consumers keep using that owner's public contract.
 */

export type { IssueMappingProfile, SchemaIssueView } from "./issue-adapter.js";
export {
  canonicalPath,
  decodeWithProfile,
  projectIssue,
  projectIssues,
  selectPrimaryIssue,
} from "./issue-adapter.js";
export type {
  JsonSafetyIssue,
  JsonSafetyIssueKind,
} from "./json-safety.js";
export { inspectJsonSafety } from "./json-safety.js";
export type {
  PlainObjectOptions,
  SchemaDecoder,
  SchemaFailureTag,
  SchemaOutput,
} from "./primitives.js";
export {
  httpUrl,
  optionalField,
  plainObject,
  positiveInteger,
  revision,
  STRUCTURAL_ISSUES,
  safeBoolean,
  safeString,
  tagged,
  utcTimestamp,
  uuid,
} from "./primitives.js";
export type { SchemaNode, SchemaOutputOf } from "./zod-mini.js";
export { z } from "./zod-mini.js";
