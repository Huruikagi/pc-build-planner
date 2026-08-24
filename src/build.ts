/**
 * 現在構成の操作と問い合わせ。`docs/reverse/features.md` 4 章に対応する。
 *
 * 現在構成はプロジェクトごとに 0 個または 1 個。ルートの置換としてのみ
 * 表現する。
 */
import {
  type BuildItem,
  type CandidatePart,
  type CurrentBuild,
  formatMoney,
  type LocalDataRoot,
  PART_CATEGORIES,
  type PartCategory,
  primarySource,
} from "./model.js";

export const buildOf = (
  root: LocalDataRoot,
  projectId: string | null,
): CurrentBuild | null =>
  projectId === null
    ? null
    : (root.currentBuilds.find((build) => build.projectId === projectId) ??
      null);

/** 現在構成を持たないプロジェクトでも、最初の採用で作られる。 */
const withItems =
  (projectId: string, next: (items: readonly BuildItem[]) => BuildItem[]) =>
  (root: LocalDataRoot): LocalDataRoot => {
    const existing = buildOf(root, projectId);
    const items = next(existing?.items ?? []);
    const build: CurrentBuild = { projectId, items };
    return {
      ...root,
      currentBuilds:
        existing === null
          ? [...root.currentBuilds, build]
          : root.currentBuilds.map((entry) =>
              entry.projectId === projectId ? build : entry,
            ),
    };
  };

export const adoptPart = (projectId: string, partId: string) =>
  withItems(projectId, (items) =>
    items.some((item) => item.partId === partId)
      ? [...items]
      : [...items, { partId, quantity: 1 }],
  );

export const releasePart = (projectId: string, partId: string) =>
  withItems(projectId, (items) =>
    items.filter((item) => item.partId !== partId),
  );

/**
 * 数量を確定する。正整数以外は呼ばれない前提で、ここでも弾く。
 * 不正値で保存済みデータを壊さない。
 */
export const setQuantity = (
  projectId: string,
  partId: string,
  quantity: number,
) =>
  withItems(projectId, (items) =>
    Number.isInteger(quantity) && quantity > 0
      ? items.map((item) =>
          item.partId === partId ? { ...item, quantity } : item,
        )
      : [...items],
  );

/** 正整数だけを受ける。入力の検証はこの 1 か所から引く。 */
export const parseQuantity = (raw: string): number | null => {
  if (!/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw.trim());
  return Number.isInteger(value) && value > 0 ? value : null;
};

export interface BuildRow {
  readonly category: PartCategory;
  readonly entries: readonly {
    readonly part: CandidatePart;
    readonly quantity: number;
  }[];
}

/**
 * カテゴリ順に採用中のパーツを並べる。同一カテゴリに複数採用できる
 * （メモリ、ストレージ、ケースファン等）。
 */
export const buildRows = (
  root: LocalDataRoot,
  projectId: string | null,
): readonly BuildRow[] => {
  const build = buildOf(root, projectId);
  const byId = new Map(root.candidateParts.map((part) => [part.id, part]));

  return PART_CATEGORIES.filter((category) => category !== "uncategorized").map(
    (category) => ({
      category,
      entries: (build?.items ?? []).flatMap((item) => {
        const part = byId.get(item.partId);
        if (part === undefined || part.category !== category) return [];
        return [{ part, quantity: item.quantity }];
      }),
    }),
  );
};

/**
 * 構成の合計金額。プライマリソースの価格 × 数量で積む。
 * 通貨が混ざる場合は合算しない（換算は対象外、`features.md` 1.4）。
 */
export const buildTotal = (
  rows: readonly BuildRow[],
): { readonly text: string; readonly mixedCurrency: boolean } | null => {
  const currencies = new Set<string>();
  let amount = 0;
  let counted = 0;

  for (const row of rows)
    for (const entry of row.entries) {
      const price = primarySource(entry.part)?.price;
      if (price == null) continue;
      currencies.add(price.currency);
      amount += price.amount * entry.quantity;
      counted += 1;
    }

  if (counted === 0) return null;
  const currency = [...currencies][0];
  if (currency === undefined) return null;
  return {
    text: formatMoney({ amount, currency }),
    mixedCurrency: currencies.size > 1,
  };
};
