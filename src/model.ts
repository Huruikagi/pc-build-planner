/**
 * 永続化されるデータの形。`docs/reverse/features.md` 1 章に対応する。
 *
 * 現時点ではプロジェクトのみ。候補パーツと現在構成は、対応する画面を実装する
 * ときにここへ足す。使う予定のフィールドを先回りして定義しないこと。
 */
import { z } from "zod";

export const SCHEMA_VERSION = 1;

const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.string(),
});

export type Project = z.infer<typeof projectSchema>;

/**
 * `chrome.storage.local` に単一キーで置くルート。書き込みはこの単位で
 * 原子的に置換する (`features.md` 6.1)。
 */
export const localDataRootSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  revision: z.number().int().nonnegative(),
  selectedProjectId: z.string().nullable(),
  projects: z.array(projectSchema),
});

export type LocalDataRoot = z.infer<typeof localDataRootSchema>;

export const createInitialRoot = (): LocalDataRoot => ({
  schemaVersion: SCHEMA_VERSION,
  revision: 0,
  selectedProjectId: null,
  projects: [],
});
