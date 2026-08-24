/**
 * content script と service worker が共有する識別子だけを置く。
 *
 * **依存を持たないこと。** content script は利用者が見ている任意のページへ
 * 注入されるので、注入するコードは小さく保つ。ここから何かを import すると
 * それがそのままページへ載る（zod を巻き込んで 583KB になっていた）。
 */

export const CAPTURE_PAYLOAD_MESSAGE = "capture-payload";

/** 進行中の取り込みを置く session storage のキー。永続化はしない。 */
export const CAPTURE_STATE_KEY = "captureState";
