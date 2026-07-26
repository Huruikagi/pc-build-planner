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
import { shell } from "./shell.js";

/**
 * 英語カタログの10個の名前空間を束ねる集約点。日本語カタログと同一の
 * 名前空間構成に揃える。値は後続タスクが名前空間ファイルごとに投入する。
 */
export const EN_MESSAGES = {
  common,
  category,
  persistenceError,
  nav,
  shell,
  candidate,
  build,
  compatibility,
  capture,
  backup,
} as const satisfies MessageNamespace;
