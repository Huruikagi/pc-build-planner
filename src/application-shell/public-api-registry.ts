import type { Result } from "../domain/public.js";
import { err, ok } from "../domain/public.js";
import type {
  PublicApiCompositionError,
  PublicApiEntry,
  PublicApiRegistry,
  RootPublicContract,
} from "./contracts.js";

export type { PublicApiCompositionError } from "./contracts.js";

export function createPublicApiRegistry<
  TEntries extends Record<string, object> = Record<string, object>,
>(): PublicApiRegistry<TEntries> {
  return {
    compose(entries) {
      return Object.freeze({ ...entries });
    },

    composeEntries<const TDynamicEntries extends readonly PublicApiEntry[]>(
      entries: TDynamicEntries,
    ) {
      const result = composeUnknownEntries(entries);
      return result as Result<
        RootPublicContract<TDynamicEntries>,
        PublicApiCompositionError
      >;
    },

    composeUnknown(entries) {
      return composeUnknownEntries(entries);
    },
  };
}

function composeUnknownEntries(
  entries: unknown,
): Result<Readonly<Record<string, object>>, PublicApiCompositionError> {
  if (!Array.isArray(entries)) {
    return err(invalidPublicApi("entries: array is required"));
  }

  const root = Object.create(null) as Record<string, object>;
  for (const [index, entry] of entries.entries()) {
    if (!isRecord(entry)) {
      return err(invalidPublicApi(`entries[${index}]: object is required`));
    }
    if (typeof entry.key !== "string" || entry.key.trim().length === 0) {
      return err(
        invalidPublicApi(`entries[${index}].key: non-empty string is required`),
      );
    }
    if (!isPublicApiObject(entry.publicApi)) {
      return err(
        invalidPublicApi(`entries[${index}].publicApi: object is required`),
      );
    }
    if (Object.hasOwn(root, entry.key)) {
      return err({ kind: "duplicate_public_api_key", key: entry.key });
    }
    Object.defineProperty(root, entry.key, {
      value: entry.publicApi,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }

  return ok(Object.freeze(root));
}

function invalidPublicApi(detail: string): PublicApiCompositionError {
  return { kind: "invalid_public_api", detail };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPublicApiObject(value: unknown): value is object {
  return isRecord(value);
}
