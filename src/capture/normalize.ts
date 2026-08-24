/**
 * ページ由来の候補を検証して採否を決める。
 *
 * **ページ由来のデータは未信頼入力**なので、ここが境界。通らなかった値は
 * 黙って捨てず、理由を残して利用者へ提示する (`docs/reverse/features.md` 2.3)。
 */
import type { Money, PartCategory } from "../model.js";
import { JA_CATEGORY_KEYWORDS } from "./category-keywords.js";
import { CURRENCY_SYMBOLS, LIMITS, YEN_SUFFIX_PATTERN } from "./rules.js";
import type {
  AcceptedField,
  CaptureField,
  CapturePayload,
  CaptureResult,
  RawCandidate,
  RejectedField,
  RejectionReason,
} from "./types.js";

const CONTROL_CHARACTERS = /\p{Cc}/gu;
const WHITESPACE_RUN = /\s+/g;

const MAX_LENGTH: Readonly<Record<CaptureField, number>> = {
  name: 300,
  manufacturer: 120,
  modelNumber: 120,
  category: 120,
  price: 60,
  url: LIMITS.urlLength,
};

/** 制御文字は空白へ畳み、連続空白を 1 つにする。混入の有無は返す。 */
const normalizeWhitespace = (
  rawValue: string,
): { readonly text: string; readonly hadControlCharacters: boolean } => {
  CONTROL_CHARACTERS.lastIndex = 0;
  const hadControlCharacters = CONTROL_CHARACTERS.test(rawValue);
  CONTROL_CHARACTERS.lastIndex = 0;
  return {
    text: rawValue
      .replace(CONTROL_CHARACTERS, " ")
      .replace(WHITESPACE_RUN, " ")
      .trim(),
    hadControlCharacters,
  };
};

/**
 * 価格の表記を金額と通貨へ分ける。
 *
 * **通貨は取得元の表記を尊重し、取れなければ推測しない**
 * (`features.md` 1.4)。通貨が判らない値は採用しない。
 */
export const parsePrice = (rawValue: string): Money | null => {
  const trimmed = rawValue.trim();

  const codeMatch = trimmed.match(/^([\d,]+(?:\.\d+)?)\s+([A-Za-z]{3})$/);
  if (codeMatch !== null) {
    const amount = Number(codeMatch[1]?.replaceAll(",", ""));
    const currency = codeMatch[2]?.toUpperCase();
    if (currency !== undefined && Number.isFinite(amount) && amount >= 0)
      return { amount, currency };
  }

  const symbolMatch = trimmed.match(/^([¥$€£])\s*([\d,]+(?:\.\d+)?)$/);
  if (symbolMatch !== null) {
    const currency = CURRENCY_SYMBOLS[symbolMatch[1] ?? ""];
    const amount = Number(symbolMatch[2]?.replaceAll(",", ""));
    if (currency !== undefined && Number.isFinite(amount) && amount >= 0)
      return { amount, currency };
  }

  const yenMatch = trimmed.match(YEN_SUFFIX_PATTERN);
  if (yenMatch !== null) {
    const amount = Number(yenMatch[1]?.replaceAll(",", ""));
    if (Number.isFinite(amount) && amount >= 0)
      return { amount, currency: "JPY" };
  }

  return null;
};

/**
 * 自由記述のカテゴリ表記から `PartCategory` を推定する。
 *
 * **推定であって確定ではない。** 編集画面の初期選択になるだけで、確定は
 * 利用者が行う (`features.md` 2.4)。
 */
export const inferCategoryHint = (raw: string): PartCategory | null => {
  const haystack = raw.toLowerCase();
  if (haystack.trim() === "") return null;
  for (const [category, keywords] of JA_CATEGORY_KEYWORDS)
    if (keywords.some((keyword) => haystack.includes(keyword))) return category;
  return null;
};

type Verdict =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: RejectionReason };

const verify = (candidate: RawCandidate): Verdict => {
  if (candidate.rawValue.length > MAX_LENGTH[candidate.field])
    return { ok: false, reason: "tooLong" };

  const { text, hadControlCharacters } = normalizeWhitespace(
    candidate.rawValue,
  );
  if (text === "") return { ok: false, reason: "empty" };
  /** 制御文字の混入は畳めば読めるが、意図された表記ではないので知らせる。 */
  if (hadControlCharacters) return { ok: false, reason: "controlCharacters" };

  if (candidate.field === "url") {
    let parsed: URL;
    try {
      parsed = new URL(text);
    } catch {
      return { ok: false, reason: "unresolvable" };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return { ok: false, reason: "invalidFormat" };
    return { ok: true, value: parsed.href };
  }

  if (candidate.field === "price") {
    const money = parsePrice(text);
    if (money === null) return { ok: false, reason: "invalidFormat" };
    return { ok: true, value: text };
  }

  return { ok: true, value: text };
};

/**
 * 候補を検証し、項目ごとに最初に通ったものを採る。
 *
 * 候補は `extract.ts` が出典の優先順（JSON-LD → meta → 見出し → パンくず
 * → 定義リスト → 表）で積んでいるので、先着順がそのまま優先順位になる。
 */
export const normalizeCapture = (
  payload: CapturePayload,
  capturedAt: string,
): CaptureResult => {
  const fields: Partial<Record<CaptureField, AcceptedField>> = {};
  const rejected: RejectedField[] = [];
  let price: CaptureResult["price"] = null;
  let categoryLabel: string | null = null;

  for (const [index, candidate] of payload.candidates.entries()) {
    const verdict = verify(candidate);
    if (!verdict.ok) {
      rejected.push({
        id: `${candidate.field}-${index}`,
        field: candidate.field,
        reason: verdict.reason,
        sourceLabel: candidate.sourceLabel,
      });
      continue;
    }

    if (candidate.field === "price") {
      if (price !== null) continue;
      const money = parsePrice(verdict.value);
      if (money === null) continue;
      price = {
        money,
        original: candidate.rawValue,
        source: candidate.source,
      };
      continue;
    }

    if (candidate.field === "category") {
      categoryLabel ??= verdict.value;
      continue;
    }

    if (fields[candidate.field] !== undefined) continue;
    fields[candidate.field] = {
      value: verdict.value,
      original: candidate.rawValue,
      source: candidate.source,
      sourceLabel: candidate.sourceLabel,
    };
  }

  /** ページが `og:url` などを持たない場合、取得したページの URL を使う。 */
  const url = fields.url?.value ?? payload.url;

  return {
    url,
    capturedAt,
    fields,
    price,
    categoryHint:
      categoryLabel === null ? null : inferCategoryHint(categoryLabel),
    rejected,
  };
};
