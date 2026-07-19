import { createUtcTimestamp } from "../domain/identifiers.js";
import type { FoundationError } from "../domain/result.js";
import {
  type FoundationRuntimeInitializationError,
  initializeFoundationRuntimeContributionFromPlatform,
} from "./runtime-contribution.js";

const invalidPlatform = (): {
  readonly ok: false;
  readonly error: FoundationRuntimeInitializationError;
} => ({ ok: false, error: { code: "invalid-platform" } });

const record = (value: unknown): Record<PropertyKey, unknown> | undefined =>
  typeof value === "object" && value !== null
    ? (value as Record<PropertyKey, unknown>)
    : undefined;

const property = (value: unknown, key: PropertyKey): unknown => {
  const target = record(value);
  return target === undefined ? undefined : Reflect.get(target, key);
};

const reportErrorCode = (error: FoundationError): void => {
  try {
    console.error(error.code);
  } catch {
    // Diagnostics are best-effort and must not affect the runtime graph.
  }
};

/** Resolve the production platform without exposing platform primitives to consumers. */
export const initializeProductionFoundationRuntimeContribution = async () => {
  try {
    const chrome = property(globalThis, "chrome");
    const storage = property(chrome, "storage");
    const storageLocal = property(storage, "local");
    const storageChanges = property(storage, "onChanged");
    const navigator = property(globalThis, "navigator");
    const locks = property(navigator, "locks");

    if (
      record(storageLocal) === undefined ||
      record(storageChanges) === undefined ||
      record(locks) === undefined
    ) {
      return invalidPlatform();
    }

    return await initializeFoundationRuntimeContributionFromPlatform({
      storageLocal: storageLocal as never,
      storageChanges: storageChanges as never,
      locks: locks as never,
      authorize: (caller) => caller.kind === "trusted-extension",
      now: createUtcTimestamp,
      reportError: reportErrorCode,
    });
  } catch {
    return invalidPlatform();
  }
};
