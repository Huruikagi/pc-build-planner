/**
 * 取り込みの型。`docs/reverse/features.md` 2 章に対応する。
 */
import type { Money, PartCategory } from "../model.js";

/** 抽出の出典。利用者へそのまま提示する (`features.md` 2.2)。 */
export type ExtractionSource =
  | "json-ld"
  | "open-graph"
  | "twitter-card"
  | "product-meta"
  | "heading"
  | "breadcrumb"
  | "table"
  | "definition-list"
  | "domain-map";

export type CaptureField =
  | "name"
  | "manufacturer"
  | "modelNumber"
  | "category"
  | "price"
  | "url";

/** 棄却の理由。黙って捨てず必ず提示する (`features.md` 2.3)。 */
export type RejectionReason =
  | "empty"
  | "tooLong"
  | "controlCharacters"
  | "invalidFormat"
  | "unresolvable";

/** ページ側が返す生の候補。検証前なので信用しない。 */
export interface RawCandidate {
  readonly field: CaptureField;
  readonly rawValue: string;
  readonly source: ExtractionSource;
  /** 出典の中での位置。`JSON-LD name`、`og:title`、仕様表の行見出しなど。 */
  readonly sourceLabel: string;
}

/** content script がページから持ち帰るもの。未信頼入力として境界で検証する。 */
export interface CapturePayload {
  readonly url: string;
  readonly title: string;
  readonly candidates: readonly RawCandidate[];
}

/** 検証を通った 1 項目。元表記を必ず伴う。 */
export interface AcceptedField {
  readonly value: string;
  /** 取得元ページでの表記そのまま。確定値と分離して保持する。 */
  readonly original: string;
  readonly source: ExtractionSource;
  readonly sourceLabel: string;
}

export interface RejectedField {
  /** 同じ項目・同じ見出しの棄却が複数出うるので、識別子を持たせる。 */
  readonly id: string;
  readonly field: CaptureField;
  readonly reason: RejectionReason;
  readonly sourceLabel: string;
}

/** 取り込み結果。利用者が確認して確定させるまでは何も確定しない。 */
export interface CaptureResult {
  readonly url: string;
  readonly capturedAt: string;
  readonly fields: Readonly<Partial<Record<CaptureField, AcceptedField>>>;
  readonly price: {
    readonly money: Money;
    readonly original: string;
    readonly source: ExtractionSource;
  } | null;
  /** 推定であって確定ではない。編集画面の初期選択になるだけ。 */
  readonly categoryHint: PartCategory | null;
  readonly rejected: readonly RejectedField[];
}

/** 取り込みの失敗。理由ごとに次の一手が変わる (`features.md` 2.5)。 */
export type CaptureFailureKind =
  | "restrictedPage"
  | "injectionFailed"
  | "invalidPayload"
  | "noCandidate"
  | "tabChanged";

/** side panel が読む、取り込みの進行状態。 */
export type CaptureState =
  | { readonly status: "extracting"; readonly tabId: number }
  | {
      readonly status: "captured";
      readonly tabId: number;
      readonly result: CaptureResult;
    }
  | {
      readonly status: "failed";
      readonly tabId: number;
      readonly kind: CaptureFailureKind;
    };
