/**
 * 候補管理の画面文言。現行の文言をそのまま転記し、`${name}を編集` / `${name}を削除` /
 * `${field}（自由入力）` および削除確認のJSX子要素列を、パラメータを受ける完結した
 * 独立キーへ再設計する。
 */
export const candidate = {
  title: "パーツ管理",
  projectsNav: "プロジェクト",
  categoryNav: "カテゴリ",
  allCategories: "すべて",
  renameProject: "名前を変更",
  projectFormTitle: "プロジェクト編集",
  newProjectNameLabel: "新しいプロジェクト名",
  projectNameLabel: "プロジェクト名",
  createProjectAction: "プロジェクトを作成",
  projectRequiredTitle: "続行するにはプロジェクトを作成してください",
  projectRequiredReason:
    "抽出したパーツを編集して保存するには、所属するプロジェクトが必要です。",
  projectRequiredExtractedSummary: "抽出済みのパーツ",
  captureDiagnosticsTitle: "取り込めなかった項目",
  captureDiagnostic: "{field}: {reason}",
  captureDiagnosticFields: {
    name: "商品名",
    category: "カテゴリ",
    manufacturer: "メーカー",
    modelNumber: "型番",
    price: "価格",
    url: "URL",
    specification: "主要スペック",
  },
  captureDiagnosticReasons: {
    empty: "値が空です",
    tooLong: "値が長すぎます",
    controlCharacters: "制御文字が含まれます",
    invalidFormat: "形式が正しくありません",
    unresolvable: "値を解釈できません",
  },
  saveProjectNameAction: "プロジェクト名を保存",
  projectNameRequiredError: "プロジェクト名を入力してください",
  createCandidateAction: "パーツを追加",
  candidateListLabel: "パーツ一覧",
  categoryFieldLabel: "カテゴリ",
  manufacturerFieldLabel: "メーカー",
  modelNumberFieldLabel: "型番",
  priceFieldLabel: "価格",
  priceEntered: "入力済み",
  missingDetailsNotice: "未入力の項目があります",
  /** `${name}を編集` の再設計。`{name}` は候補の表示名を受け取る。 */
  editCandidateAction: "{name}を編集",
  editAction: "編集",
  /** `${name}を削除` の再設計。 */
  deleteCandidateAction: "{name}を削除",
  deleteConfirmationTitle: "削除確認",
  deleteConfirmationHeading: "削除を確認",
  /** 「プロジェクト「{name}」と所属する候補も削除します。」のJSX子要素列を1つの文へ再設計。 */
  deleteProjectMessage: "プロジェクト「{name}」と所属するパーツも削除します。",
  /** 「候補「{name}」を削除します。」の再設計。 */
  deleteCandidateMessage: "パーツ「{name}」を削除します。",
  confirmDeleteAction: "削除する",
  editorFormTitle: "パーツ編集",
  createCandidateHeading: "パーツを追加",
  editCandidateHeading: "パーツを編集",
  nameRequiredError: "商品名を入力してください",
  nameFieldLabel: "商品名",
  priceNotNumberError: "数値で入力してください",
  customOptionLabel: "その他（自由入力）",
  /** `${field.label}（自由入力）` の再設計。`{field}` は解決済みの項目ラベルを受け取る。 */
  customFieldAriaLabel: "{field}（自由入力）",
  customListLabel: "その他（カンマ区切りで自由入力）",
  sourceUrlLabel: "取得元URL",
  capturedAtLabel: "取得日時",
  sourceSnapshotLabel: "取得元表記",
  sources: {
    label: "ソース",
    kind: { retail: "販売ページ", manufacturer: "メーカー商品紹介" },
    primary: "プライマリ",
    add: "ソースを追加",
    remove: "ソースを削除",
    open: "ソースを開く",
    errors: {
      replacementRequired:
        "プライマリを削除するには代わりのソースを選択してください",
      invalidUrl: "http または https のURLを入力してください",
      openFailed: "ソースを開けませんでした",
      runtimeUnavailable: "この環境ではソースを開けません",
    },
  },
  duplicate: {
    title: "既存パーツとの一致を確認",
    description:
      "一致するパーツを確認し、新規保存または統合を選択してください。",
    candidateLabel: "統合先パーツ",
    fields: {
      manufacturer: "メーカー",
      modelNumber: "型番",
      category: "カテゴリ",
      confidence: "確信度",
      evidence: "一致根拠",
    },
    confidence: { high: "高", supporting: "補助" },
    evidence: {
      modelNumber: "型番が一致",
      manufacturerName: "メーカーと商品名が一致",
    },
    actions: {
      saveNew: "新しいパーツとして保存",
      merge: "選択したパーツへ統合",
      retry: "再試行",
    },
    errors: {
      query: "パーツ一覧を読み込めませんでした。入力内容は保持されています。",
      conflict: "パーツが更新されています。もう一度照合してください。",
      ambiguous: "保存済みソースを一意に特定できませんでした。",
      source: "ソースを統合できませんでした。既存パーツは変更されていません。",
      invalidSource: "取得元URLを修正してから、もう一度統合してください。",
      storage: "保存領域を利用できません。入力内容は保持されています。",
      stale: "一致するパーツが古くなりました。もう一度照合してください。",
      unexpected: "統合を完了できませんでした。入力内容は保持されています。",
    },
  },
  attributeLabels: {
    socket: "ソケット",
    supportedSockets: "対応ソケット",
    memoryStandard: "メモリ規格",
    formFactor: "フォームファクター",
    supportedMotherboardFormFactors: "対応マザーボード規格",
    supportedPowerSupplyFormFactors: "対応電源規格",
  },
  fieldErrors: {
    default: "入力内容を確認してください",
    required: "必須項目です",
    "invalid-url": "http またはhttps のURLを入力してください",
    "invalid-utc-timestamp": "UTCの日時形式で入力してください",
    "invalid-string": "文字列として入力してください",
    "invalid-array": "カンマ区切りの文字列で入力してください",
    "category-mismatch": "選択したカテゴリでは受け付けられない値です",
    "unexpected-field": "選択したカテゴリでは受け付けられない項目です",
    "missing-field": "必須項目です",
    "forbidden-payload": "保存できない内容が含まれています",
  },
  errors: {
    unsupportedData:
      "保存データが破損しているか、対応していない形式です。既存データは変更していません。",
    storage:
      "保存領域を利用できません。拡張機能を開き直してからもう一度お試しください。",
    notFound: "対象が見つかりませんでした。一覧を読み込み直してください。",
  },
} as const;
