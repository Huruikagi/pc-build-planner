export type {
  AppDataError,
  AppDataErrorValidationFailure,
} from "./app-data-error.js";
export {
  mapFoundationError,
  validateAppDataError,
} from "./app-data-error.js";
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
  CandidatePartDraft,
  ReplaceableRoot,
  SchemaValidator,
  ValidationError,
  ValidationErrorCode,
} from "./validation.js";
export {
  candidateSourcePageUrlPath,
  isJsonValue,
  schemaValidator,
  validateCandidatePartContent,
  validateCandidatePartDraft,
  validateCandidatePartValue,
} from "./validation.js";
