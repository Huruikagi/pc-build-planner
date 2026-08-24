/**
 * 候補パーツのライフサイクルと問い合わせ。
 *
 * ルートの置換としてのみ表現する (`docs/reverse/features.md` 6.1)。
 */
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
  readonly category: PartCategory;
  readonly attributes: Readonly<Record<string, string>>;
  readonly sources: readonly CandidateSource[];
}

export const emptyDraft = (): PartDraft => ({
  id: null,
  name: "",
  manufacturer: "",
  modelNumber: "",
  category: "uncategorized",
  attributes: {},
  sources: [],
});

/** 確定値だけをフォームへ出す。元表記は読み取り専用で別に見せる。 */
export const draftFromPart = (part: CandidatePart): PartDraft => ({
  id: part.id,
  name: part.name,
  manufacturer: part.manufacturer?.confirmed ?? "",
  modelNumber: part.modelNumber?.confirmed ?? "",
  category: part.category,
  attributes: Object.fromEntries(
    Object.entries(part.attributes).map(([key, value]) => {
      const confirmed = value.confirmed;
      if (confirmed === undefined) return [key, ""];
      return [key, Array.isArray(confirmed) ? confirmed.join(", ") : confirmed];
    }),
  ),
  sources: part.sources,
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

export const deletePart = (id: string) => (root: LocalDataRoot) => ({
  ...root,
  candidateParts: root.candidateParts.filter((part) => part.id !== id),
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
        existing?.manufacturer,
        draft.manufacturer.trim() === ""
          ? undefined
          : draft.manufacturer.trim(),
      ),
      modelNumber: withConfirmed(
        existing?.modelNumber,
        draft.modelNumber.trim() === "" ? undefined : draft.modelNumber.trim(),
      ),
      category: draft.category,
      attributes,
      sources: [...draft.sources],
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
