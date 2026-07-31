import type {
  AssertCatalogParity,
  FlattenLocalizedCatalog,
  LocalizedCatalog,
} from "../../catalog-parity.js";
import type { MessageKeyOf, MessageNamespace } from "../../contracts.js";
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

/** 日本語カタログの12個の名前空間を束ねる集約点。 */
export const MESSAGES = {
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

export type MessageKey = MessageKeyOf<typeof MESSAGES>;

/** 言語から独立した「カタログの形」。`catalog-parity.ts` の `LocalizedCatalog` と同一。 */
export type MessageCatalogShape = LocalizedCatalog;

/**
 * 日本語はソース言語であり、自分自身との整合は常に成立する。この表明は
 * 「各言語カタログの宣言直後にコンパイル時表明を置く」パターンの実例であり、
 * `en` 側は値の投入（タスク4.x）が全名前空間を埋めた時点で同じ表明を置く。
 */
type _AssertJaCatalogParity = AssertCatalogParity<
  FlattenLocalizedCatalog<typeof MESSAGES>
>;
