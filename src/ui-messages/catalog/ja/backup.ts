/**
 * バックアップ・復元の画面文言。診断メッセージ表は現行の文言をそのまま転記する。
 * 位置情報を伴う合成文と復元完了の件数合成文は、パラメータを受ける完結した文へ再設計する。
 */
export const backup = {
  title: "バックアップと復元",
  noticeUninstall:
    "拡張機能を削除すると、保存されているローカルデータは失われる可能性があります。",
  noticeFileOwnership: "生成したファイルの保管は利用者の責任です。",
  noticeNoAutoBackup: "バックアップは自動作成・クラウド保存・同期されません。",
  exportHeading: "バックアップ作成",
  exportAction: "バックアップを作成",
  exporting: "バックアップを作成しています…",
  /** `${filename} をダウンロードしました。` の再設計。 */
  downloaded: "{filename} をダウンロードしました。",
  restoreHeading: "復元",
  validating: "ファイルを確認しています…",
  restoreConfirmationTitle: "復元の確認",
  restoreWarning: "現在の全データが選択したファイルの内容で置き換わります。",
  createdAtLabel: "作成日時",
  formatVersionLabel: "形式版",
  projectCountLabel: "プロジェクト数",
  partCountLabel: "パーツ数",
  currentBuildCountLabel: "現在構成数",
  confirmAction: "復元を確定",
  draftConfirmationTitle: "未保存の編集の確認",
  draftWarning:
    "現在のプロジェクトに未保存の編集があります。復元するとこの編集は破棄されます。",
  approveDraftAction: "破棄して復元",
  retryRestoreAction: "復元を再試行",
  reassessRestoreAction: "選択したファイルを再確認",
  finalizationRequired:
    "復元は完了しましたが、後処理が残っています。後処理を実行してください。",
  finalizeAction: "後処理を実行",
  contextUnavailable:
    "復元は完了しましたが、現在のプロジェクトを再確認できませんでした。",
  refreshContextAction: "現在のプロジェクトを再確認",
  restoring: "復元しています…",
  /** 「復元が完了しました（プロジェクト{n}件、候補{n}件、現在構成{n}件）。」の再設計。 */
  restoreCompleted:
    "復元が完了しました（プロジェクト{projectCount}件、パーツ{partCount}件、現在構成{currentBuildCount}件）。",
  /** `${base}（位置: ${path}）` の再設計。`{message}` は解決済みの基本文を受け取る。 */
  withPosition: "{message}（位置: {path}）",
  errors: {
    "no-file-selected": "ファイルが選択されていません。",
    "multiple-files-selected": "ファイルは一つだけ選択してください。",
    unreadable: "ファイルを読み取れませんでした。",
    "size-exceeded": "ファイルサイズが上限を超えています。",
    "not-json": "JSONとして読み取れないファイルです。",
    "invalid-structure": "ファイルの形式が不正です。",
    "invalid-reference": "ファイル内の参照関係が不正です。",
    "unsupported-version": "対応していない形式のバージョンです。",
    "quota-exceeded": "保存容量が不足しています。",
    "storage-unavailable": "保存領域を利用できません。",
    "corrupt-current-data":
      "保存データが破損しています。既存データは変更していません。",
    "unsupported-current-data":
      "保存データが対応していない形式です。既存データは変更していません。",
    "stale-ticket":
      "確認内容が古くなりました。もう一度ファイルを選び直してください。",
    "maintenance-active":
      "他の保守処理が進行中です。しばらくしてからお試しください。",
    storage: "保存領域を利用できません。",
    serialization: "データの変換に失敗しました。",
    "guard-failed":
      "未保存の編集を保存または破棄してから、もう一度復元してください。",
    "context-unavailable":
      "現在のプロジェクトを利用できません。既存データは変更していません。",
  },
} as const;
