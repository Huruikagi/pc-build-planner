/**
 * 重複判定。`docs/reverse/features.md` 3 章に対応する。
 *
 * 保存時に同一プロジェクト内の既存パーツと商品同一性を照合する。
 * 判定するのは「一致の可能性」までで、どうするかは利用者が選ぶ。
 * 排他 2 択（新規保存 / 統合）を提示するだけで、勝手に統合しない。
 *
 * 正規化の規則は v0.4.0 (`salvage/extraction/product-identity-normalizer.ts`,
 * `salvage/identity/url-identity.ts`) から引き継いだ。
 */
import type {
  CandidatePart,
  CandidateSource,
  LocalDataRoot,
  SourcedText,
} from "./model.js";
import type { PartDraft } from "./parts.js";

/** 型番は区切り文字を落として比較する。`SYN-100 X` と `syn100x` は同じ。 */
const MODEL_NUMBER_SEPARATORS = /[\s_-]+/gu;

const fold = (value: string): string =>
  value
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .normalize("NFKC")
    .toLowerCase();

const modelKey = (value: string): string =>
  fold(value).replace(MODEL_NUMBER_SEPARATORS, "");

/**
 * ソースの同一性。ユーザー情報とフラグメントは同一性に関与しないので落とす。
 * クエリは商品を特定しうるので残す。
 */
export const sourceIdentity = (url: string): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  parsed.username = "";
  parsed.password = "";
  parsed.hash = "";
  return parsed.toString();
};

export type MatchEvidence = "modelNumber" | "manufacturerAndName";

export interface DuplicateMatch {
  readonly part: CandidatePart;
  readonly evidence: MatchEvidence;
  /** 型番一致は高、メーカーと商品名の一致は補助。 */
  readonly confidence: "high" | "supporting";
}

/** 比較には確定値を優先し、無ければ元表記を使う。 */
const comparable = (value: SourcedText | null): string | null => {
  const selected = value?.confirmed ?? value?.original;
  if (selected == null) return null;
  const folded = fold(selected);
  return folded === "" ? null : folded;
};

/**
 * 同一プロジェクト内の既存パーツから一致候補を探す。
 * 確信度の高い順に返す。
 */
export const findDuplicates = (
  root: LocalDataRoot,
  projectId: string,
  draft: PartDraft,
): readonly DuplicateMatch[] => {
  /** 「型番なし」の表明は比較の根拠にならない。 */
  const draftModel = draft.modelNumberAbsent ? "" : draft.modelNumber.trim();
  const draftManufacturer = fold(draft.manufacturer.trim());
  const draftName = fold(draft.name.trim());

  const matches: DuplicateMatch[] = [];
  for (const part of root.candidateParts) {
    if (part.projectId !== projectId) continue;
    if (part.id === draft.id) continue;

    const partModel = part.modelNumber?.confirmed ?? part.modelNumber?.original;
    if (
      draftModel !== "" &&
      partModel != null &&
      modelKey(partModel) !== "" &&
      modelKey(partModel) === modelKey(draftModel)
    ) {
      matches.push({ part, evidence: "modelNumber", confidence: "high" });
      continue;
    }

    const partManufacturer = comparable(part.manufacturer);
    if (
      draftManufacturer !== "" &&
      partManufacturer !== null &&
      partManufacturer === draftManufacturer &&
      fold(part.name) === draftName
    )
      matches.push({
        part,
        evidence: "manufacturerAndName",
        confidence: "supporting",
      });
  }

  return matches.sort((left, right) =>
    left.confidence === right.confidence
      ? 0
      : left.confidence === "high"
        ? -1
        : 1,
  );
};

/**
 * 同じ URL のソースを既に持つパーツを探す。
 *
 * 同一 URL の再取り込みは新規作成ではなく既存ソースの更新として扱う
 * (`features.md` 3 章)。照合は保存前に行い、利用者へ選択を出す前に解決する。
 */
export const findBySourceUrl = (
  root: LocalDataRoot,
  projectId: string,
  url: string,
): CandidatePart | null => {
  const identity = sourceIdentity(url);
  if (identity === null) return null;
  return (
    root.candidateParts.find(
      (part) =>
        part.projectId === projectId &&
        part.sources.some((source) => sourceIdentity(source.url) === identity),
    ) ?? null
  );
};

/**
 * 既存のソース一覧へ、取り込んだソースを重ねる。
 *
 * 同じ URL のソースは中身を置き換える（再取り込みでの価格更新）。
 * その際も id とプライマリ指定は既存のものを維持し、価格の基準を動かさない。
 * 新しく増えるソースはプライマリにしない。
 */
export const mergeSources = (
  existing: readonly CandidateSource[],
  incoming: readonly CandidateSource[],
): CandidateSource[] => {
  const sources: CandidateSource[] = [...existing];
  for (const source of incoming) {
    const identity = sourceIdentity(source.url);
    const index = sources.findIndex(
      (entry) => sourceIdentity(entry.url) === identity,
    );
    if (index === -1) {
      sources.push({ ...source, primary: sources.length === 0 });
      continue;
    }
    const previous = sources[index];
    if (previous === undefined) continue;
    sources[index] = { ...source, id: previous.id, primary: previous.primary };
  }
  return sources;
};

/**
 * 下書きのソースを既存パーツへ統合する。既存の確定値は壊さない。
 * 統合するのはソースだけで、名前や規格は既存パーツのものが残る。
 */
export const mergeIntoPart =
  (targetId: string, draft: PartDraft) =>
  (root: LocalDataRoot): LocalDataRoot => ({
    ...root,
    candidateParts: root.candidateParts.map((part) =>
      part.id === targetId
        ? { ...part, sources: mergeSources(part.sources, draft.sources) }
        : part,
    ),
  });
