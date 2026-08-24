/**
 * service worker / content script / side panel の間で使う識別子と、
 * 未信頼メッセージの検証。
 *
 * content script はページ上で走るので、そこから来るメッセージは
 * ページ由来の未信頼入力として扱う。
 */
import { z } from "zod";

import { CAPTURE_PAYLOAD_MESSAGE, CAPTURE_STATE_KEY } from "./channel.js";
import type { CaptureState } from "./types.js";

export { CAPTURE_PAYLOAD_MESSAGE, CAPTURE_STATE_KEY };

const rawCandidate = z.object({
  field: z.enum([
    "name",
    "manufacturer",
    "modelNumber",
    "category",
    "price",
    "url",
  ]),
  rawValue: z.string(),
  source: z.enum([
    "json-ld",
    "open-graph",
    "twitter-card",
    "product-meta",
    "heading",
    "breadcrumb",
    "table",
    "definition-list",
    "domain-map",
  ]),
  sourceLabel: z.string(),
});

export const capturePayloadSchema = z.object({
  url: z.string(),
  title: z.string(),
  candidates: z.array(rawCandidate).max(200),
});

export const capturePayloadMessageSchema = z.object({
  type: z.literal(CAPTURE_PAYLOAD_MESSAGE),
  payload: capturePayloadSchema,
});

export const readCaptureState = async (): Promise<CaptureState | undefined> => {
  const stored = await chrome.storage.session.get(CAPTURE_STATE_KEY);
  return stored[CAPTURE_STATE_KEY] as CaptureState | undefined;
};

export const writeCaptureState = (state: CaptureState): Promise<void> =>
  chrome.storage.session.set({ [CAPTURE_STATE_KEY]: state });

export const clearCaptureState = (): Promise<void> =>
  chrome.storage.session.remove(CAPTURE_STATE_KEY);

/**
 * side panel から見た取り込み状態の口。`StorageDriver` と同じ理由で
 * 差し替え可能にしてある。拡張では chrome.storage.session、dev harness では
 * メモリ。ここを直参照にすると `chrome` の無い harness で App が落ちる。
 *
 * 書き込みは service worker の側にしかないので、この口は読み取りと解除だけ。
 */
export interface CaptureDriver {
  read(): Promise<CaptureState | undefined>;
  clear(): Promise<void>;
  /** 変更通知の購読。戻り値を呼ぶと解除する。 */
  subscribe(onChange: () => void): () => void;
}

export const chromeCaptureDriver: CaptureDriver = {
  read: readCaptureState,
  clear: clearCaptureState,
  subscribe(onChange) {
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "session" && CAPTURE_STATE_KEY in changes) onChange();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  },
};

export const createMemoryCaptureDriver = (
  seed?: CaptureState,
): CaptureDriver => {
  let current = seed;
  const listeners = new Set<() => void>();
  return {
    async read() {
      return current;
    },
    async clear() {
      current = undefined;
      for (const listener of listeners) listener();
    },
    subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
  };
};
