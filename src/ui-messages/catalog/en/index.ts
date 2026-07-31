import type {
  AssertCatalogParity,
  FlattenLocalizedCatalog,
} from "../../catalog-parity.js";
import type { MessageNamespace } from "../../contracts.js";
import { backup } from "./backup.js";
import { build } from "./build.js";
import { candidate } from "./candidate.js";
import { capture } from "./capture.js";
import { category } from "./category.js";
import { common } from "./common.js";
import { compatibility } from "./compatibility.js";
import { nav } from "./nav.js";
import { persistenceError } from "./persistence-error.js";
import { settings } from "./settings.js";
import { shell } from "./shell.js";
import { sourcePriceRefresh } from "./source-price-refresh.js";

/**
 * 英語カタログの12個の名前空間を束ねる集約点。日本語カタログと同一の
 * 名前空間構成に揃える。
 */
export const EN_MESSAGES = {
  common,
  category,
  persistenceError,
  nav,
  shell,
  settings,
  candidate,
  build,
  compatibility,
  capture,
  backup,
  sourcePriceRefresh,
} as const satisfies MessageNamespace;

/**
 * ja側と同じキー集合を持つことのコンパイル時表明（タスク1.2のパターン）。
 * プレースホルダ名の一致は型では扱わない。`catalog-parity.test.ts`（タスク4.6）
 * が唯一の検証手段である。
 */
type _AssertEnCatalogParity = AssertCatalogParity<
  FlattenLocalizedCatalog<typeof EN_MESSAGES>
>;
