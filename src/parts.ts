/**
 * 候補パーツのライフサイクルと問い合わせ。
 *
 * ルートの置換としてのみ表現する (`docs/reverse/features.md` 6.1)。
 */
import { manufacturerDomainEntryForUrl } from "./capture/manufacturer-domain-map.js";
import type { CaptureResult } from "./capture/types.js";
import {
  CATEGORY_ATTRIBUTES,
  type CandidatePart,
  type CandidateSource,
  type LocalDataRoot,
  type PartCategory,
  type SourcedAttribute,
} from "./model.js";

/** フォームが扱う編集中の値。保存時に `CandidatePart` へ変換する。 */
export interface PartDraft {
  readonly id: string | null;
  readonly name: string;
  readonly manufacturer: string;
  readonly modelNumber: string;
  /**
   * 型番を持たない商品だと確認済みであることの表明。空欄のままの「まだ調べて
   * いない」と区別するために持つ。真なら `modelNumber` は無視して空を確定する。
   */
  readonly modelNumberAbsent: boolean;
  readonly category: PartCategory;
  readonly attributes: Readonly<Record<string, string>>;
  readonly sources: readonly CandidateSource[];
  /**
   * 取り込み時の元表記。新規パーツを取り込みから作るときだけ意味を持ち、
   * 既存パーツの編集では保存済みの original が優先される。
   */
  readonly originals: Readonly<Partial<Record<IdentityField, string>>>;
}

/** 元表記を持ちうる項目。カテゴリと規格値は利用者が確定させるもの。 */
export type IdentityField = "name" | "manufacturer" | "modelNumber";

export const emptyDraft = (): PartDraft => ({
  id: null,
  name: "",
  manufacturer: "",
  modelNumber: "",
  modelNumberAbsent: false,
  category: "uncategorized",
  attributes: {},
  sources: [],
  originals: {},
});

/** 確定値だけをフォームへ出す。元表記は読み取り専用で別に見せる。 */
export const draftFromPart = (part: CandidatePart): PartDraft => ({
  id: part.id,
  name: part.name,
  manufacturer: part.manufacturer?.confirmed ?? "",
  modelNumber: part.modelNumber?.confirmed ?? "",
  modelNumberAbsent: part.modelNumber?.confirmed === "",
  category: part.category,
  attributes: Object.fromEntries(
    Object.entries(part.attributes).map(([key, value]) => {
      const confirmed = value.confirmed;
      if (confirmed === undefined) return [key, ""];
      return [key, Array.isArray(confirmed) ? confirmed.join(", ") : confirmed];
    }),
  ),
  sources: part.sources,
  originals: {
    ...(part.manufacturer?.original == null
      ? {}
      : { manufacturer: part.manufacturer.original }),
    ...(part.modelNumber?.original == null
      ? {}
      : { modelNumber: part.modelNumber.original }),
  },
});

export const partsOf = (
  root: LocalDataRoot,
  projectId: string | null,
): readonly CandidatePart[] =>
  projectId === null
    ? []
    : root.candidateParts.filter((part) => part.projectId === projectId);

export const countByCategory = (
  parts: readonly CandidatePart[],
): ReadonlyMap<PartCategory, number> => {
  const counts = new Map<PartCategory, number>();
  for (const part of parts)
    counts.set(part.category, (counts.get(part.category) ?? 0) + 1);
  return counts;
};

/** 候補を削除すると現在構成からも解除される (`features.md` 4 章)。 */
export const deletePart = (id: string) => (root: LocalDataRoot) => ({
  ...root,
  candidateParts: root.candidateParts.filter((part) => part.id !== id),
  currentBuilds: root.currentBuilds.map((build) => ({
    ...build,
    items: build.items.filter((item) => item.partId !== id),
  })),
});

/**
 * 空文字は「未入力」であって空文字の確定ではない。`confirmed` を落として
 * 表現する。欠損は正常状態なので、保存を拒まない (`features.md` 2 章)。
 */
const withConfirmed = <T>(
  previous: { readonly original: string | null } | null | undefined,
  confirmed: T | undefined,
) => {
  const base = { original: previous?.original ?? null };
  return confirmed === undefined ? base : { ...base, confirmed };
};

/** 新規作成時は下書きが持つ元表記を初期値にする。 */
const originalOf = (draft: PartDraft, field: IdentityField) => {
  const original = draft.originals[field];
  return original === undefined ? null : { original };
};

/**
 * 型番だけは空文字の確定に意味がある。「型番なし」を確定させると
 * `missingFieldCount` から外れ、重複判定でも比較対象にならない。
 */
const modelNumberConfirmation = (draft: PartDraft): string | undefined => {
  if (draft.modelNumberAbsent) return "";
  const trimmed = draft.modelNumber.trim();
  return trimmed === "" ? undefined : trimmed;
};

const parseList = (raw: string): string[] =>
  raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");

/**
 * 下書きを候補パーツへ変換する。既存パーツの `original`（取り込み時の元表記）は
 * 必ず引き継ぐ。編集で書き換わるのは `confirmed` だけ (`features.md` 1.2)。
 */
export const savePart =
  (draft: PartDraft, projectId: string) => (root: LocalDataRoot) => {
    const existing =
      draft.id === null
        ? null
        : (root.candidateParts.find((part) => part.id === draft.id) ?? null);

    const attributes: Record<string, SourcedAttribute> = {};
    for (const definition of CATEGORY_ATTRIBUTES[draft.category]) {
      const raw = (draft.attributes[definition.key] ?? "").trim();
      const previous = existing?.attributes[definition.key] ?? null;
      if (definition.kind === "list") {
        const parsed = parseList(raw);
        attributes[definition.key] = withConfirmed(
          previous,
          parsed.length === 0 ? undefined : parsed,
        );
        continue;
      }
      attributes[definition.key] = withConfirmed(
        previous,
        raw === "" ? undefined : raw,
      );
    }

    const next: CandidatePart = {
      id: existing?.id ?? crypto.randomUUID(),
      projectId: existing?.projectId ?? projectId,
      name: draft.name.trim(),
      manufacturer: withConfirmed(
        existing?.manufacturer ?? originalOf(draft, "manufacturer"),
        draft.manufacturer.trim() === ""
          ? undefined
          : draft.manufacturer.trim(),
      ),
      modelNumber: withConfirmed(
        existing?.modelNumber ?? originalOf(draft, "modelNumber"),
        modelNumberConfirmation(draft),
      ),
      category: draft.category,
      attributes,
      sources: draft.sources.map((source) => ({
        ...source,
        url: source.url.trim(),
        price:
          source.price === null
            ? null
            : { ...source.price, currency: source.price.currency.trim() },
      })),
    };

    return {
      ...root,
      candidateParts:
        existing === null
          ? [...root.candidateParts, next]
          : root.candidateParts.map((part) =>
              part.id === next.id ? next : part,
            ),
    };
  };

/**
 * 取り込み結果を編集用の下書きへ引き渡す。
 *
 * ここで保存はしない。抽出は補助であり、確定させるのは利用者
 * (`docs/reverse/features.md` 2 章)。カテゴリは推定を初期選択に置くだけ。
 */
export const draftFromCapture = (result: CaptureResult): PartDraft => {
  const sourceId = crypto.randomUUID();
  return {
    id: null,
    name: result.fields.name?.value ?? "",
    manufacturer: result.fields.manufacturer?.value ?? "",
    modelNumber: result.fields.modelNumber?.value ?? "",
    modelNumberAbsent: false,
    category: result.categoryHint ?? "uncategorized",
    attributes: {},
    sources: [
      {
        id: sourceId,
        url: result.url,
        /**
         * メーカー公式ドメインは販売ページではなく商品紹介として記録する。
         * この判定は manufacturer 抽出の成否ではなく、取り込み URL 自体で行う。
         */
        kind:
          manufacturerDomainEntryForUrl(result.url) === undefined
            ? "retail"
            : "manufacturer",
        capturedAt: result.capturedAt,
        price: result.price?.money ?? null,
        /** 最初のソースは必ずプライマリ。価格の基準になる。 */
        primary: true,
      },
    ],
    originals: {
      ...(result.fields.name === undefined
        ? {}
        : { name: result.fields.name.original }),
      ...(result.fields.manufacturer === undefined
        ? {}
        : { manufacturer: result.fields.manufacturer.original }),
      ...(result.fields.modelNumber === undefined
        ? {}
        : { modelNumber: result.fields.modelNumber.original }),
    },
  };
};
