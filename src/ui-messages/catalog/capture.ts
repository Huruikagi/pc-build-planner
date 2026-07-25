/**
 * 商品取り込みの画面文言。現行の文言をそのまま転記する。カテゴリ表示名は
 * 共有 `category` 名前空間を使い、重複定義を作らない。
 * `推定: {label}（詳細編集の初期選択になります）` と
 * `候補を保存しました（保存先: {projectName}）。` はパラメータを受ける独立キーへ再設計する。
 */
export const capture = {
  fields: {
    name: "商品名",
    category: "カテゴリ",
    price: "価格",
    manufacturer: "メーカー",
    modelNumber: "型番",
    url: "URL",
  },
  sources: {
    "json-ld": "構造化データ",
    meta: "メタ情報",
    heading: "見出し",
    breadcrumb: "パンくず",
    table: "表",
    "definition-list": "定義リスト",
  },
  /** `取得元: ${label}（${sourceLabel}）` の再設計。 */
  sourceAttribution: "取得元: {source}（{sourceLabel}）",
  /** `元表記: ${original}` の再設計。 */
  originalValueLabel: "元表記: {value}",
  missingFieldStatus: "未入力の項目です",
  categoryHintUnknown: "推定できませんでした（詳細編集で選択します）",
  /** `推定: ${label}（詳細編集の初期選択になります）` の再設計。 */
  categoryHintEstimated: "推定: {label}（詳細編集の初期選択になります）",
  rejectedFieldsLabel: "取得できなかった項目",
  saveDestinationLabel: "保存先プロジェクト",
  selectPrompt: "選択してください",
  noProjectsNotice:
    "保存先のプロジェクトがありません。先にプロジェクトを作成してください。",
  detailEditAction: "詳細編集",
  retryCaptureAction: "取り込み直す",
  idleTitle: "取り込み",
  idleInstruction: "拡張のアイコンから取り込みを開始してください。",
  startAction: "取り込みを開始",
  extractingTitle: "取り込み中",
  extractingStatus: "ページを取り込んでいます…",
  submittingTitle: "保存中",
  submittingStatus: "保存しています…",
  savedTitle: "保存完了",
  savedWithoutProject: "候補を保存しました。",
  /** `候補を保存しました（保存先: ${projectName}）。` の再設計。 */
  savedWithProject: "候補を保存しました（保存先: {projectName}）。",
  captureAnotherAction: "別のページを取り込む",
  failedTitle: "取り込み失敗",
  retryAction: "再実行",
  manualEntryTitle: "手入力での登録案内",
  manualEntryInstruction: "商品名を入力すると詳細編集へ進めます。",
  errors: {
    "permission-lost":
      "ページへのアクセス権限が失効しました。ページを表示し直してから再実行してください。",
    "restricted-page":
      "このページは拡張から読み取れないため取り込みの対象外です。",
    "tab-changed":
      "取り込み中にページが移動または更新されました。表示中のページで再実行してください。",
    "injection-failed":
      "ページの読み取りに失敗しました。もう一度実行してください。",
    "invalid-payload":
      "ページから取得した内容を解釈できませんでした。もう一度実行してください。",
    "no-candidate": "このページからは商品情報を自動取得できませんでした。",
    "project-required":
      "保存先のプロジェクトを選択してください。プロジェクトがない場合は先に作成してください。",
    navigation: "詳細編集画面を開けませんでした。",
    storage: "保存領域を利用できません。もう一度お試しください。",
    unsupportedData: "保存データが破損しているか、対応していない形式です。",
  },
} as const;
