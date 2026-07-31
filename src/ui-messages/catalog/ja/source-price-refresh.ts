/**
 * 価格更新の一過性表示面の文言。進行・成功・失敗の3状態と、失敗kindごとの
 * 安定した原因・回復案内だけを持つ。URL、商品名、raw HTML、例外内容は
 * 文言にも埋め込まない（要件5.6）。
 *
 * `guidance` は design.md のエラー表を典拠に共有し、`errors` の各kindから
 * 参照する。再実行では解消しない案内、すなわち保存データの修復を先に求める
 * 三つ（`reviewStoredSources`、`deduplicateSources`、`repairStoredSource`）と、
 * 利用者の操作では解消しない `reportExtensionDefect` にだけ再実行を書かない。
 */
export const sourcePriceRefresh = {
  title: "価格の更新",
  runningStatus: "価格を更新しています…",
  succeededStatus: "価格を更新しました。",
  failedStatus: "価格を更新できませんでした。",
  priceLabel: "更新後の価格",
  /** 確定済みの金額と通貨だけを表示する。元表記は表示しない。 */
  priceValue: "{amount} {currency}",
  capturedAtLabel: "取得日時",
  primaryLabel: "候補一覧の代表価格",
  primaryUpdated: "この取得元は代表価格に反映されました。",
  primaryUnchanged: "この取得元は代表ではないため、代表価格は変わりません。",
  preservedNotice: "保存済みの価格と取得日時はそのまま残しています。",
  errors: {
    "invalid-url": "対象ページのURLを照合できる形に解釈できませんでした。",
    "no-match": "このページに対応する保存済みの取得元が見つかりませんでした。",
    "ambiguous-match":
      "このページに一致する保存済みの取得元が複数あり、更新対象を一つに絞れませんでした。",
    "ineligible-source": "一致した取得元は販売ページとして指定されていません。",
    "price-unavailable": "このページから有効な価格を取得できませんでした。",
    "stale-activation":
      "より新しい操作が開始されたため、この更新は中止しました。",
    "stale-target": "更新を確定する前に対象の取得元が変わりました。",
    "tab-unavailable": "対象のページを参照できませんでした。",
    "permission-lost": "ページへのアクセス権限が失効しました。",
    "restricted-page":
      "このページは拡張から読み取れないため、価格更新の対象外です。",
    "tab-changed": "更新中にページが移動または再読み込みされました。",
    "injection-failed": "ページの読み取りに失敗しました。",
    "invalid-payload": "ページから取得した内容を解釈できませんでした。",
    validation: "保存されている取得元の内容が保存条件を満たしていません。",
    "unsupported-data":
      "保存されているデータの形式を解釈できないため、更新を確定しませんでした。",
    conflict: "ほかの変更と競合したため、更新を確定しませんでした。",
    maintenance: "保存基盤が保守中のため、更新を確定しませんでした。",
    storage: "保存領域の障害により、更新を確定しませんでした。",
    quota: "保存容量が不足しているため、更新を確定しませんでした。",
    unexpected:
      "拡張機能の内部で想定外の問題が発生し、更新を完了できませんでした。",
  },
  guidance: {
    reviewStoredSources: "保存済みの取得元一覧を確認してください。",
    deduplicateSources: "重複している取得元を整理してください。",
    repairStoredSource: "対象候補の取得元の内容を修正してください。",
    retryOnRetailSource:
      "販売ページとして保存した取得元のページで、もう一度実行してください。",
    retryOnEligiblePage:
      "価格更新の対象になるページを表示し、もう一度実行してください。",
    checkPageThenRetry:
      "ページ上の価格表示を確認してから、もう一度実行してください。",
    retryFromContextMenu:
      "対象のページを表示し直し、コンテキストメニューからもう一度実行してください。",
    reloadCandidateThenRetry:
      "最新の候補を読み込み直してから、もう一度実行してください。",
    retryAfterMaintenance: "保守が終わってから、もう一度実行してください。",
    checkStorageThenRetry:
      "保存領域の空き容量を確認してから、もう一度実行してください。",
    reportExtensionDefect:
      "同じ操作を繰り返しても解消しません。拡張機能の更新を確認し、それでも続く場合は開発元へ報告してください。",
  },
} as const;
