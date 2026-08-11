/** 現在構成の画面文言。現行の文言をそのまま転記する。 */
export const build = {
  title: "現在構成",
  projectsNav: "プロジェクト",
  categoryNav: "カテゴリ",
  candidateListLabel: "パーツ一覧",
  noCandidates: "パーツがありません",
  noCurrentBuild: "現在構成がありません",
  select: "選択",
  add: "追加",
  remove: "解除",
  confirmQuantity: "数量を確定",
  invalidQuantity: "正整数を入力してください",
  notFound: "対象のパーツが見つかりませんでした。読み込み直してください。",
  corruptData: "保存データが破損しています。既存データは変更していません。",
  unsupportedData:
    "保存データが対応していない形式です。既存データは変更していません。",
  storage:
    "保存領域を利用できません。拡張機能を開き直してからもう一度お試しください。",
  summaryEmpty: "未選択",
  summaryCategory: "{category}: {summary}",
  summaryQuantity: "{name} × {quantity}",
  summaryAccessibleQuantity: "{name}、数量 {quantity}",
  summarySeparator: "、",
  projectEmpty:
    "プロジェクトがありません。共通のプロジェクト画面で作成してください。",
  projectUnavailable:
    "プロジェクトを利用できません。しばらくしてから再読み込みしてください。",
  switchConfirmation:
    "未保存の数量があります。プロジェクトを切り替える前に処理を選んでください。",
  switchSave: "保存して切り替え",
  switchDiscard: "破棄して切り替え",
  switchCancel: "切替を取消",
  orphanedDraft:
    "強制的なプロジェクト変更のため、未保存の数量を隔離して保持しています。新しいプロジェクトには保存されません。",
  orphanedDismiss: "隔離中の入力を破棄",
} as const;
