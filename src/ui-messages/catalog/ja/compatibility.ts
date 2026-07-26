/**
 * 互換性確認の画面文言。現行の文言をそのまま転記し、助詞連結だった箇所を
 * `{side}` パラメータを受ける完結した文へ再設計する。
 */
export const compatibility = {
  title: "互換性確認",
  idle: "互換性の評価を開始してください。",
  loading: "評価しています…",
  resultsLabel: "個別判定結果",
  missingFieldsLabel: "不足項目",
  /** 「{側ラベル}が選択されていません。」の再設計。側ラベルは既に解決済みの文字列を受け取る。 */
  missingCategory: "{side}が選択されていません。",
  /** 「{側ラベル}の値が未確認です。」の再設計。 */
  missingConfirmedValue: "{side}の値が未確認です。",
  /** 「${側ラベル}（未選択）」の再設計。 */
  unselectedParty: "{side}（未選択）",
  rules: {
    "cpu-motherboard-socket": {
      name: "CPUソケット",
      left: "CPU",
      right: "マザーボード",
    },
    "motherboard-memory-ddr": {
      name: "メモリ規格",
      left: "マザーボード",
      right: "メモリ",
    },
    "cooler-cpu-socket": {
      name: "CPUクーラー対応ソケット",
      left: "CPU",
      right: "CPUクーラー",
    },
    "case-motherboard-form-factor": {
      name: "ケース対応フォームファクタ",
      left: "マザーボード",
      right: "ケース",
    },
    "case-psu-form-factor": {
      name: "ケース対応電源規格",
      left: "電源",
      right: "ケース",
    },
  },
  reasons: {
    "value-equal": "規格が一致しています。",
    "value-not-equal": "規格が一致していません。",
    "value-included": "対応範囲に含まれています。",
    "value-not-included": "対応範囲に含まれていません。",
    "input-missing": "必要な確認済み情報が不足しています。",
  },
  aggregate: {
    compatible: "互換性あり",
    incompatible: "互換性なし",
    caution: "注意事項あり",
    unknown: "情報不足で判定不能",
  },
  empty: {
    "no-build": "現在構成が選択されていません。パーツを選択してください。",
    "invalid-reference":
      "現在構成に不正な参照が含まれています。構成を確認してください。",
  },
  failure: {
    "corrupt-data": "保存データが破損しています。互換性を判定できません。",
    "unsupported-data":
      "保存データが対応していない形式です。互換性を判定できません。",
    "read-failed": "データを読み込めませんでした。互換性を判定できません。",
  },
} as const;
