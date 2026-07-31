import { err, ok, type Result } from "../../domain/public.js";
import type {
  NormalizedSourcePageUrl,
  SourceUrlIdentityError,
} from "./contracts.js";

const acceptedProtocols: ReadonlySet<string> = new Set(["http:", "https:"]);

/** Campaign keys that never identify a product, removed case-insensitively. */
const trackingKeys: ReadonlySet<string> = new Set([
  "gclid",
  "dclid",
  "fbclid",
  "msclkid",
]);

const trackingKeyPrefix = "utm_";

const invalidUrl: SourceUrlIdentityError = { kind: "invalid-url" };

interface QueryPair {
  readonly key: string;
  readonly value: string;
  readonly index: number;
}

const isTrackingKey = (key: string): boolean => {
  const lowered = key.toLowerCase();
  return lowered.startsWith(trackingKeyPrefix) || trackingKeys.has(lowered);
};

/** Orders by key, then value, then original index so equal pairs stay stable. */
const compareQueryPairs = (left: QueryPair, right: QueryPair): number => {
  if (left.key !== right.key) return left.key < right.key ? -1 : 1;
  if (left.value !== right.value) return left.value < right.value ? -1 : 1;
  return left.index - right.index;
};

/**
 * Keeps every unknown pair, including repeated keys and empty values, and
 * relies only on `URLSearchParams` serialization instead of custom decoding.
 */
const normalizeQuery = (search: string): string => {
  const pairs: QueryPair[] = [...new URLSearchParams(search)]
    .map(([key, value], index) => ({ key, value, index }))
    .filter((pair) => !isTrackingKey(pair.key));
  pairs.sort(compareQueryPairs);
  const normalized = new URLSearchParams();
  for (const pair of pairs) normalized.append(pair.key, pair.value);
  const serialized = normalized.toString();
  return serialized === "" ? "" : `?${serialized}`;
};

/** Drops a single trailing slash from every path except the root path. */
const normalizePath = (pathname: string): string =>
  pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;

/**
 * Converts an HTTP/HTTPS page URL into a conservative comparison key that
 * tolerates tracking, ordering and formatting differences while preserving the
 * scheme, host, path and any query value that may identify a product.
 */
export const normalizeSourcePageUrl = (
  value: string,
): Result<NormalizedSourcePageUrl, SourceUrlIdentityError> => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return err(invalidUrl);
  }
  if (!acceptedProtocols.has(parsed.protocol)) return err(invalidUrl);
  const host = parsed.host.toLowerCase();
  if (host === "") return err(invalidUrl);
  const normalized = `${parsed.protocol}//${host}${normalizePath(
    parsed.pathname,
  )}${normalizeQuery(parsed.search)}`;
  return ok(normalized as NormalizedSourcePageUrl);
};

/** True only when both values are acceptable URLs with the same comparison key. */
export const sameSourcePageUrl = (left: string, right: string): boolean => {
  const normalizedLeft = normalizeSourcePageUrl(left);
  if (!normalizedLeft.ok) return false;
  const normalizedRight = normalizeSourcePageUrl(right);
  return normalizedRight.ok && normalizedLeft.value === normalizedRight.value;
};
