import {
  err,
  isUtcTimestamp,
  isUuid,
  ok,
  type ProjectId,
  type Result,
} from "../domain/public.js";
import type {
  ProjectCatalogError,
  ProjectCatalogItem,
  ProjectCatalogProjection,
  ProjectCatalogSource,
  ProjectContextSnapshot,
  ProjectContextUnavailableReason,
} from "./contracts.js";

const INVALID_CATALOG: ProjectCatalogError = { kind: "invalid-catalog" };
const SOURCE_UNAVAILABLE: ProjectCatalogError = { kind: "source-unavailable" };

/** `empty` snapshot が共有する不変な空 catalog。 */
const EMPTY_CATALOG: readonly [] = Object.freeze([]);

/**
 * source entry から `id` / `name` / `updatedAt` だけを不変 item へ複製する。
 * 一つでも解釈できない field があれば `undefined` を返し、呼び出し側が
 * catalog 全体を拒否できるようにする（要件 1.1、design ProjectCatalogProjection）。
 */
const toCatalogItem = (entry: unknown): ProjectCatalogItem | undefined => {
  if (typeof entry !== "object" || entry === null) {
    return undefined;
  }

  const { id, name, updatedAt } = entry as {
    readonly id?: unknown;
    readonly name?: unknown;
    readonly updatedAt?: unknown;
  };

  if (!isUuid(id)) {
    return undefined;
  }
  // 空文字・空白のみの名前は「空でないことを保証できない name」として拒否する。
  if (typeof name !== "string" || name.trim() === "") {
    return undefined;
  }
  if (!isUtcTimestamp(updatedAt)) {
    return undefined;
  }

  return Object.freeze({ id: id as ProjectId, name, updatedAt });
};

/**
 * source 順序を保ったまま全-or-nothing で射影する。duplicate ID、不正 entry を
 * 見つけた時点で catalog 全体を拒否し、部分 catalog を返さない（要件 1.3、2.4）。
 */
const projectEntries = (
  entries: unknown,
): Result<readonly ProjectCatalogItem[], ProjectCatalogError> => {
  if (!Array.isArray(entries)) {
    return err(INVALID_CATALOG);
  }

  const items: ProjectCatalogItem[] = [];
  const seenIds = new Set<string>();

  for (const entry of entries) {
    const item = toCatalogItem(entry);
    if (item === undefined) {
      return err(INVALID_CATALOG);
    }
    if (seenIds.has(item.id)) {
      return err(INVALID_CATALOG);
    }
    seenIds.add(item.id);
    items.push(item);
  }

  return ok(Object.freeze(items));
};

/** 注入された source を最小 catalog projection へ包む。並べ替えや補完は行わない。 */
export const createProjectCatalogProjection = (
  source: ProjectCatalogSource,
): ProjectCatalogProjection => ({
  async load() {
    let listed: Result<readonly ProjectCatalogItem[], ProjectCatalogError>;
    try {
      listed = await source.list();
    } catch {
      // source の例外は値も vendor error も外へ出さず、安定した失敗へ閉じる。
      return err(SOURCE_UNAVAILABLE);
    }

    if (!listed.ok) {
      return err(listed.error);
    }

    return projectEntries(listed.value);
  },
});

const containsExactlyOnce = (
  catalog: readonly ProjectCatalogItem[],
  projectId: ProjectId,
): boolean =>
  catalog.reduce(
    (count, item) => (item.id === projectId ? count + 1 : count),
    0,
  ) === 1;

/**
 * 決定的な選択解決（要件 2.3、2.4、4.2、4.3）。
 * 希望 ID が catalog に一意に存在すればそれを維持し、そうでなければ source 順の
 * 先頭（index 0）だけを fallback に使う。名前や日時での再整列は行わない。
 */
export const resolveProjectCatalogSelection = (
  catalog: readonly ProjectCatalogItem[],
  preferredProjectId: ProjectId | null,
): ProjectId | null => {
  if (
    preferredProjectId !== null &&
    containsExactlyOnce(catalog, preferredProjectId)
  ) {
    return preferredProjectId;
  }

  const first = catalog[0];
  return first === undefined ? null : first.id;
};

/** 現在 project を公開しない `unavailable` snapshot を作る（要件 1.3、1.5）。 */
export const unavailableProjectContextSnapshot = (
  generation: number,
  reason: ProjectContextUnavailableReason,
): ProjectContextSnapshot =>
  Object.freeze({
    status: "unavailable" as const,
    generation,
    selectedProjectId: null,
    reason,
  });

/**
 * catalog projection の結果と希望選択から、全 consumer が共有する一つの snapshot を
 * 確定する（要件 1.1、1.2、1.3、1.6、4.2）。consumer 側の fallback を不要にする唯一の入口。
 */
export const createProjectContextSnapshot = (input: {
  readonly generation: number;
  readonly catalog: Result<readonly ProjectCatalogItem[], ProjectCatalogError>;
  readonly preferredProjectId: ProjectId | null;
}): ProjectContextSnapshot => {
  if (!input.catalog.ok) {
    return unavailableProjectContextSnapshot(
      input.generation,
      "catalog-unavailable",
    );
  }

  const [first, ...rest] = input.catalog.value;
  if (first === undefined) {
    return Object.freeze({
      status: "empty" as const,
      generation: input.generation,
      catalog: EMPTY_CATALOG,
      selectedProjectId: null,
    });
  }

  const catalog: readonly [ProjectCatalogItem, ...ProjectCatalogItem[]] =
    Object.freeze([first, ...rest]);

  return Object.freeze({
    status: "ready" as const,
    generation: input.generation,
    catalog,
    // catalog が非空である以上、解決結果は必ず non-null になる。
    selectedProjectId:
      resolveProjectCatalogSelection(catalog, input.preferredProjectId) ??
      first.id,
  });
};
