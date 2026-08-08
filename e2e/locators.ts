/**
 * Compatibility barrel for E2E locator helpers.
 *
 * New helpers belong to the feature-oriented modules under `models/`, or to
 * `support/expected-text.ts` when they do not locate UI at all.
 */
export * from "./models/application-shell.js";
export * from "./models/candidate-management.js";
export * from "./models/current-build.js";
export * from "./models/locator-primitives.js";
export * from "./models/product-capture.js";
export * from "./models/project-context.js";
export * from "./models/settings.js";
export * from "./models/source-price-refresh.js";
export * from "./support/expected-text.js";
