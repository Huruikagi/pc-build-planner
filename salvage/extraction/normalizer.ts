import { err, ok, type Result } from "../../domain/public.js";
import type {
  CaptureField,
  CaptureFieldRejection,
  CaptureFieldRejectionReason,
  ExtractionCandidate,
  NormalizedField,
  SiteNameCandidate,
  SourcedSiteName,
} from "./contracts.js";
import {
  isCaptureField,
  isCaptureSourceLabel,
  MAX_CAPTURE_LABEL_LENGTH,
  SITE_NAME_SOURCE_LABEL,
} from "./contracts.js";
import {
  YEN_SUFFIX_PATTERN,
  YEN_SYMBOL_CURRENCY,
} from "./locale/ja-price-tokens.js";

/**
 * Why an optional site name was not adopted. It is deliberately not a
 * `CaptureFieldRejection`: a rejected site name is not a rejected product
 * item, and must not appear in the capture result's rejected-field list.
 */
export type SiteNameRejectionReason = Extract<
  CaptureFieldRejectionReason,
  "empty" | "too-long" | "control-characters"
>;

export interface CaptureNormalizer {
  normalize(
    candidate: ExtractionCandidate,
  ): Result<NormalizedField, CaptureFieldRejection>;
  normalizeSiteName(
    candidate: SiteNameCandidate,
  ): Result<SourcedSiteName, SiteNameRejectionReason>;
}

const MAX_TEXT_LENGTH = 200;
const MAX_URL_LENGTH = 2000;
const MAX_PRICE_LENGTH = 50;

const CONTROL_CHARACTERS = /\p{Cc}/gu;
const WHITESPACE_RUN = /\s+/g;

const reject = (
  field: CaptureField,
  reason: CaptureFieldRejectionReason,
): Result<NormalizedField, CaptureFieldRejection> => err({ field, reason });

const accept = (
  candidate: ExtractionCandidate,
  normalizedValue: NormalizedField["normalizedValue"],
): Result<NormalizedField, CaptureFieldRejection> =>
  ok({
    field: candidate.field,
    normalizedValue,
    rawValue: candidate.rawValue,
    source: candidate.source,
    sourceLabel: candidate.sourceLabel,
    documentOrder: candidate.documentOrder,
  });

export const normalizeWhitespaceAndControlCharacters = (
  rawValue: string,
): { readonly text: string; readonly hadControlCharacters: boolean } => {
  const hadControlCharacters = CONTROL_CHARACTERS.test(rawValue);
  CONTROL_CHARACTERS.lastIndex = 0;
  const withoutControlCharacters = rawValue.replace(CONTROL_CHARACTERS, " ");
  const text = withoutControlCharacters.replace(WHITESPACE_RUN, " ").trim();
  return { text, hadControlCharacters };
};

const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  "¥": YEN_SYMBOL_CURRENCY,
  $: "USD",
  "€": "EUR",
  "£": "GBP",
};

const parsePrice = (
  rawValue: string,
): { readonly amount: number; readonly currency: string } | undefined => {
  const trimmed = rawValue.trim();

  const codeMatch = trimmed.match(/^([\d,]+(?:\.\d+)?)\s+([A-Za-z]{3})$/);
  if (codeMatch) {
    const amount = Number(codeMatch[1]?.replaceAll(",", ""));
    const currency = codeMatch[2]?.toUpperCase();
    if (currency && Number.isFinite(amount) && amount >= 0)
      return { amount, currency };
  }

  const symbolMatch = trimmed.match(/^([¥$€£])\s*([\d,]+(?:\.\d+)?)$/);
  if (symbolMatch) {
    const symbol = symbolMatch[1] ?? "";
    const amount = Number(symbolMatch[2]?.replaceAll(",", ""));
    const currency = CURRENCY_SYMBOLS[symbol];
    if (currency && Number.isFinite(amount) && amount >= 0)
      return { amount, currency };
  }

  const yenMatch = trimmed.match(YEN_SUFFIX_PATTERN);
  if (yenMatch) {
    const amount = Number(yenMatch[1]?.replaceAll(",", ""));
    if (Number.isFinite(amount) && amount >= 0)
      return { amount, currency: YEN_SYMBOL_CURRENCY };
  }

  return undefined;
};

const normalizeUrl = (
  candidate: ExtractionCandidate,
): Result<NormalizedField, CaptureFieldRejection> => {
  if (candidate.rawValue.length > MAX_URL_LENGTH)
    return reject(candidate.field, "too-long");

  let parsed: URL;
  try {
    parsed = new URL(candidate.rawValue);
  } catch {
    return reject(candidate.field, "unresolvable");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    return reject(candidate.field, "invalid-format");

  return accept(candidate, parsed.href);
};

const normalizePriceField = (
  candidate: ExtractionCandidate,
): Result<NormalizedField, CaptureFieldRejection> => {
  if (candidate.rawValue.length > MAX_PRICE_LENGTH)
    return reject(candidate.field, "too-long");

  const parsed = parsePrice(candidate.rawValue);
  if (parsed === undefined) return reject(candidate.field, "unresolvable");

  return accept(candidate, {
    amount: parsed.amount,
    currency: parsed.currency,
  });
};

const normalizeTextField = (
  candidate: ExtractionCandidate,
): Result<NormalizedField, CaptureFieldRejection> => {
  if (candidate.rawValue.length > MAX_TEXT_LENGTH)
    return reject(candidate.field, "too-long");

  const { text, hadControlCharacters } =
    normalizeWhitespaceAndControlCharacters(candidate.rawValue);
  if (text.length === 0)
    return reject(
      candidate.field,
      hadControlCharacters ? "control-characters" : "empty",
    );

  return accept(candidate, text);
};

export const createCaptureNormalizer = (): CaptureNormalizer => ({
  normalize(candidate) {
    if (!isCaptureField(candidate.field))
      return reject(candidate.field, "invalid-format");
    const sourceLabelIsValid: boolean = isCaptureSourceLabel(
      candidate.sourceLabel,
    );
    if (!sourceLabelIsValid) {
      const reason: CaptureFieldRejectionReason =
        candidate.sourceLabel.length > MAX_CAPTURE_LABEL_LENGTH
          ? "too-long"
          : CONTROL_CHARACTERS.test(candidate.sourceLabel)
            ? "control-characters"
            : "empty";
      CONTROL_CHARACTERS.lastIndex = 0;
      return reject(candidate.field, reason);
    }
    if (candidate.field === "url") return normalizeUrl(candidate);
    if (candidate.field === "price") return normalizePriceField(candidate);
    return normalizeTextField(candidate);
  },

  /**
   * Applies the same untrusted-text rules the product fields get, but closes
   * every failure to the site name alone: an unusable display name is a normal
   * partial result, never a reason to fail the surrounding extraction.
   */
  normalizeSiteName(candidate) {
    if (candidate.rawValue.length > MAX_TEXT_LENGTH) return err("too-long");

    const { text, hadControlCharacters } =
      normalizeWhitespaceAndControlCharacters(candidate.rawValue);
    if (text.length === 0)
      return err(hadControlCharacters ? "control-characters" : "empty");

    return ok({
      value: text,
      rawValue: candidate.rawValue,
      source: "open-graph",
      sourceLabel: SITE_NAME_SOURCE_LABEL,
    });
  },
});
