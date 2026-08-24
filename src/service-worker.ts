/**
 * MV3 service worker。取り込みの起点を持つ。
 *
 * ページの読み取りは**利用者が拡張アイコンを操作した時だけ**行い、
 * 権限はその都度の `activeTab` に限る。恒久的な host permission は持たない
 * (`docs/reverse/requirements.md` 6 章)。
 */
import { normalizeCapture } from "./capture/normalize.js";
import {
  capturePayloadMessageSchema,
  clearCaptureState,
  writeCaptureState,
} from "./capture/protocol.js";
import type { CaptureFailureKind } from "./capture/types.js";

/** 拡張が読み取れないページ。注入を試みる前に弾いて理由を明確にする。 */
const isRestricted = (url: string | undefined): boolean =>
  url === undefined ||
  /^(chrome|chrome-extension|edge|about|devtools|view-source):/.test(url) ||
  url.startsWith("https://chromewebstore.google.com/");

const fail = (tabId: number, kind: CaptureFailureKind): Promise<void> =>
  writeCaptureState({ status: "failed", tabId, kind });

chrome.action.onClicked.addListener(async (tab) => {
  const tabId = tab.id;
  if (tabId === undefined) return;

  /**
   * 先にパネルを開く。`sidePanel.open` は利用者の操作を要求するので、
   * 注入の完了を待ってからでは操作の文脈が切れる。
   */
  await chrome.sidePanel.open({ tabId });

  if (isRestricted(tab.url)) {
    await fail(tabId, "restrictedPage");
    return;
  }

  /** 新しい操作は、前回の結果や失敗を置き換える (`features.md` 2.1)。 */
  await writeCaptureState({ status: "extracting", tabId });

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content-script.js"],
    });
  } catch {
    await fail(tabId, "injectionFailed");
  }
});

chrome.runtime.onMessage.addListener((message, sender) => {
  const parsed = capturePayloadMessageSchema.safeParse(message);
  if (!parsed.success) return;

  const tabId = sender.tab?.id;
  if (tabId === undefined) return;

  const { payload } = parsed.data;
  if (payload.candidates.length === 0) {
    void fail(tabId, "noCandidate");
    return;
  }

  void writeCaptureState({
    status: "captured",
    tabId,
    result: normalizeCapture(payload, new Date().toISOString()),
  });
});

/** 対象タブが遷移したら取り込みは無効。古い結果を引き渡さない。 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url === undefined) return;
  void (async () => {
    const stored = await chrome.storage.session.get("captureState");
    const state = stored.captureState as { tabId?: number } | undefined;
    if (state?.tabId === tabId) await fail(tabId, "tabChanged");
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const stored = await chrome.storage.session.get("captureState");
    const state = stored.captureState as { tabId?: number } | undefined;
    if (state?.tabId === tabId) await clearCaptureState();
  })();
});
