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
  /** 取得時分類は確認済み分類とは別に保持する。 */
  readonly originalCategory: string | null;
  readonly capturedAttributeCategory: PartCategory | null;
  /** 既存カテゴリに属する、取り込み由来の読み取り専用元表記。 */
  readonly originalAttributes: Readonly<Record<string, string>>;
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
  originalCategory: null,
  capturedAttributeCategory: null,
  originalAttributes: {},
});

/** 確定値だけをフォームへ出す。元表記は読み取り専用で別に見せる。 */
export const draftFromPart = (part: CandidatePart): PartDraft => ({
  id: part.id,
  name: part.name?.confirmed ?? "",
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
    ...(part.name?.original == null ? {} : { name: part.name.original }),
    ...(part.manufacturer?.original == null
      ? {}
      : { manufacturer: part.manufacturer.original }),
    ...(part.modelNumber?.original == null
      ? {}
      : { modelNumber: part.modelNumber.original }),
  },
  originalCategory: part.originalCategory,
  capturedAttributeCategory: part.capturedAttributeCategory,
  originalAttributes: Object.fromEntries(
    Object.entries(part.attributes).flatMap(([key, value]) =>
      value.original === null ? [] : [[key, value.original]],
    ),
  ),
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

/** 名称、確認済み分類、属性、取得元のいずれかがあれば保存対象になる。 */
export const draftHasIdentifyingInformation = (draft: PartDraft): boolean =>
  draft.name.trim() !== "" ||
  draft.originals.name !== undefined ||
  draft.category !== "uncategorized" ||
  Object.values(draft.attributes).some((value) => value.trim() !== "") ||
  Object.keys(draft.originalAttributes).length > 0 ||
  draft.sources.length > 0;

export type CandidateDeletionReferenceCleanup = (
  root: LocalDataRoot,
  candidateId: string,
) => LocalDataRoot;

const candidateDeletionReferenceCleanups: CandidateDeletionReferenceCleanup[] =
  [];

/** 候補参照の意味を所有する側が、純粋な整理変換を登録する。 */
export const registerCandidateDeletionReferenceCleanup = (
  cleanup: CandidateDeletionReferenceCleanup,
): (() => void) => {
  candidateDeletionReferenceCleanups.push(cleanup);
  return () => {
    const index = candidateDeletionReferenceCleanups.indexOf(cleanup);
    if (index !== -1) candidateDeletionReferenceCleanups.splice(index, 1);
  };
};

/** 登録順に各変換を一度ずつ適用する。例外時は呼出元へ失敗を返す。 */
export const applyCandidateDeletionReferenceCleanup = (
  root: LocalDataRoot,
  candidateId: string,
): LocalDataRoot =>
  candidateDeletionReferenceCleanups.reduce(
    (current, cleanup) => cleanup(current, candidateId),
    root,
  );

/** 参照整理が全て成功したルートからだけ候補を除く。 */
export const deletePart = (id: string) => (root: LocalDataRoot) => {
  const cleaned = applyCandidateDeletionReferenceCleanup(root, id);
  return {
    ...cleaned,
    candidateParts: cleaned.candidateParts.filter((part) => part.id !== id),
  };
};

/**
 * 空文字は「未入力」であって空文字の確定ではない。`confirmed` を落として
 * 表現する。欠損は正常状態なので、保存を拒まない (`features.md` 2 章)。
 */
const withConfirmed = <T>(
  previous: { readonly original: string | null } | null | undefined,
  confirmed: T | undefined,
): { readonly original: string | null; readonly confirmed?: T } | null => {
  const base = { original: previous?.original ?? null };
  if (base.original === null && confirmed === undefined) return null;
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
    const targetProjectId = existing?.projectId ?? projectId;
    if (!root.projects.some((project) => project.id === targetProjectId))
      throw new Error("candidate project does not exist");

    const attributes: Record<string, SourcedAttribute> = {};
    const definitions = new Map(
      [
        ...CATEGORY_ATTRIBUTES[draft.category],
        ...(draft.capturedAttributeCategory === null
          ? []
          : CATEGORY_ATTRIBUTES[draft.capturedAttributeCategory]),
      ].map((definition) => [definition.key, definition]),
    );
    const confirmedKeys = new Set(
      CATEGORY_ATTRIBUTES[draft.category].map(({ key }) => key),
    );
    for (const definition of definitions.values()) {
      const raw = (draft.attributes[definition.key] ?? "").trim();
      const previous = existing?.attributes[definition.key] ?? null;
      const original =
        draft.originalAttributes[definition.key] ?? previous?.original ?? null;
      const previousWithOriginal = { original };
      if (!confirmedKeys.has(definition.key)) {
        if (original !== null)
          attributes[definition.key] = previousWithOriginal;
        continue;
      }
      if (definition.kind === "list") {
        const parsed = parseList(raw);
        const value = withConfirmed(
          previousWithOriginal,
          parsed.length === 0 ? undefined : parsed,
        );
        if (value !== null) attributes[definition.key] = value;
        continue;
      }
      const value = withConfirmed(
        previousWithOriginal,
        raw === "" ? undefined : raw,
      );
      if (value !== null) attributes[definition.key] = value;
    }

    const name = withConfirmed(
      existing?.name ?? originalOf(draft, "name"),
      draft.name.trim() === "" ? undefined : draft.name.trim(),
    );

    if (!draftHasIdentifyingInformation(draft))
      throw new Error(
        "candidate must contain a name, category, attribute, or source",
      );

    const next: CandidatePart = {
      id: existing?.id ?? crypto.randomUUID(),
      projectId: targetProjectId,
      name,
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
      originalCategory: draft.originalCategory,
      capturedAttributeCategory: draft.capturedAttributeCategory,
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
 * ここで保存はしない。抽出は補助であり、元表記と取得時分類は利用者が
 * 確認するまで確認済み入力や `category` へ昇格させない。
 */
export interface CandidateCaptureHandoff {
  readonly originals: Readonly<{
    name: string | null;
    manufacturer: string | null;
    modelNumber: string | null;
    category: string | null;
  }>;
  readonly capturedAttributeCategory: PartCategory | null;
  readonly attributes: Readonly<Record<string, string>>;
  readonly source: Readonly<{
    url: string;
    kind: CandidateSource["kind"];
    capturedAt: string;
    price: CandidateSource["price"];
  }>;
}

export const draftFromCaptureHandoff = (
  handoff: CandidateCaptureHandoff,
): PartDraft => {
  const sourceId = crypto.randomUUID();
  const allowedAttributeKeys = new Set(
    handoff.capturedAttributeCategory === null
      ? []
      : CATEGORY_ATTRIBUTES[handoff.capturedAttributeCategory].map(
          ({ key }) => key,
        ),
  );
  return {
    id: null,
    name: "",
    manufacturer: "",
    modelNumber: "",
    modelNumberAbsent: false,
    category: "uncategorized",
    attributes: {},
    sources: [
      {
        id: sourceId,
        ...handoff.source,
        /** 最初のソースは必ずプライマリ。価格の基準になる。 */
        primary: true,
      },
    ],
    originals: {
      ...(handoff.originals.name === null
        ? {}
        : { name: handoff.originals.name }),
      ...(handoff.originals.manufacturer === null
        ? {}
        : { manufacturer: handoff.originals.manufacturer }),
      ...(handoff.originals.modelNumber === null
        ? {}
        : { modelNumber: handoff.originals.modelNumber }),
    },
    originalCategory: handoff.originals.category,
    capturedAttributeCategory: handoff.capturedAttributeCategory,
    originalAttributes: Object.fromEntries(
      Object.entries(handoff.attributes).filter(([key]) =>
        allowedAttributeKeys.has(key),
      ),
    ),
  };
};
