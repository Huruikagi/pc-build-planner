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
