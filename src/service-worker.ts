/**
 * MV3 service worker。
 *
 * いまは拡張アイコンでサイドパネルを開くことだけを行う。取り込みの起動や
 * タブ監視は、商品取り込みを実装するときにここへ足す。
 */

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});
