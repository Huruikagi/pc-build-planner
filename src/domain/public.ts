export * from "./identifiers.js";
export * from "./model.js";
export * from "./normalized-attributes.js";
export type {
  FoundationError,
  FoundationErrorCode,
  Result,
} from "./result.js";
export { err, ok } from "./result.js";
export type {
  CandidatePartContent,
  ReplaceableRoot,
  SchemaValidator,
  ValidationError,
  ValidationErrorCode,
} from "./validation.js";
export {
  isJsonValue,
  schemaValidator,
  validateCandidatePartContent,
} from "./validation.js";
