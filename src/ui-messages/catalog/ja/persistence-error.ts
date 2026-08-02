/**
 * 永続化失敗の共有文言。文字列として完全一致するものだけを統合する
 * （`validation` / `maintenance` / `quota` / `conflict` / `snapshotRestoreFailed`）。
 * `storage` / `notFound` / `unsupportedData` / `corruptData` は feature ごとに
 * 文面が異なるため、ここへは含めず各 feature 名前空間で個別に保持する。
 */
export const persistenceError = {
  validation: "入力内容を確認してください。",
  maintenance: "保守操作の実行中です。完了後にもう一度お試しください。",
  quota:
    "保存容量が不足しています。不要なパーツを削除してからもう一度お試しください。",
  conflict:
    "他の変更と競合しました。最新の内容を読み込んでからもう一度お試しください。",
  snapshotRestoreFailed: "前回の画面状態を復元できませんでした。",
} as const;
