import {
  defaultMessageResolver,
  resolverFor,
} from "../../src/ui-messages/public.js";

/** Resolves catalog text for E2E expected-value assertions. */
export const expectedText = defaultMessageResolver;

/** Resolves catalog text for a specific display language. */
export const expectedTextFor = resolverFor;
