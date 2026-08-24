/**
 * ロケールごとに変わる表示文言のうち、E2E が実際に突き合わせるものだけ。
 *
 * ここに書くのは「i18n が効いていること」を示すための最小限。
 * 振る舞いの検証はロケール非依存のセレクタ (`data-*` / role) で行う。
 * 文言を増やすときは `_locales` が正で、本ファイルは写しにすぎない。
 */
export const EXPECTED = {
  ja: {
    nav: ["候補", "構成", "互換性"],
    projectMenuHeading: "プロジェクトを切り替え",
    partNameRequired: "商品名を入力してください",
    /** カテゴリ表示名。属性欄の出し分けが効いているかの確認に使う。 */
    categoryCpu: "CPU",
    attributeSocket: "ソケット",
  },
  en: {
    nav: ["Parts", "Build", "Fit"],
    projectMenuHeading: "Switch project",
    partNameRequired: "Enter a product name",
    categoryCpu: "CPU",
    attributeSocket: "Socket",
  },
} as const;

export type ExpectedLocale = keyof typeof EXPECTED;
