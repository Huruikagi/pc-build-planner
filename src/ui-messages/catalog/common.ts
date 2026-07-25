/** 機能横断で繰り返し現れる短語。現行の文言をそのまま転記する。 */
export const common = {
  notEntered: "未入力",
  notSelected: "未選択",
  save: "保存",
  delete: "削除",
  dismiss: "取消",
  cancel: "キャンセル",
  /** 読点による列挙結合の区切り文字（`value.join("、")` の置き換え先）。 */
  listSeparator: "、",
} as const;
