import type {
  MessageDefinition,
  MessageKeyOf,
  MessageNamespace,
} from "../contracts.js";
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

/** 10個の名前空間を束ねる唯一の集約点。以降のタスクは各名前空間ファイルだけを編集する。 */
export const MESSAGES = {
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

export type MessageKey = MessageKeyOf<typeof MESSAGES>;

/** 言語から独立した「カタログの形」。後続 spec の `en` はこの型を満たす。 */
export type MessageCatalogShape = {
  readonly [K in MessageKey]: MessageDefinition;
};
