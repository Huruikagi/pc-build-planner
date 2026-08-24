/**
 * 利用者が拡張アイコンを操作したときだけ、その都度注入される。
 *
 * `chrome.scripting.executeScript({ files })` は classic script として注入
 * するので、このエントリだけ IIFE で別ビルドする (`scripts/build.mjs`)。
 *
 * ページ側で持つ責務は抽出だけ。検証も採否もここではしない。
 */

import { CAPTURE_PAYLOAD_MESSAGE } from "./channel.js";
import { extractFromDocument } from "./extract.js";

const payload = extractFromDocument(document, location.href);
void chrome.runtime.sendMessage({ type: CAPTURE_PAYLOAD_MESSAGE, payload });
