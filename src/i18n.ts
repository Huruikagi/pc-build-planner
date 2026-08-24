/**
 * Chrome 標準の拡張 i18n を唯一の文言解決手段とする薄いラッパ。
 *
 * 表示言語はブラウザの UI 言語で決まり、拡張内から切り替える手段は持たない
 * (`docs/reverse/features.md` 7.2)。ここに独自のロケール解決を足さないこと。
 *
 * `chrome.i18n` が無い環境 (dev harness) だけ、ビルド時に埋め込んだカタログへ
 * 落ちる。拡張として動くときは常に `chrome.i18n` を通る。
 */

interface MessagePlaceholder {
  readonly content: string;
}

interface MessageEntry {
  readonly message: string;
  readonly placeholders?: Readonly<Record<string, MessagePlaceholder>>;
}

export type MessageCatalog = Readonly<Record<string, MessageEntry>>;

let fallbackCatalog: MessageCatalog | null = null;

/** dev harness 専用。拡張ランタイムでは呼ばれない。 */
export const installMessageFallback = (catalog: MessageCatalog): void => {
  fallbackCatalog = catalog;
};

/** `$1` `$2` 形式の参照を実引数へ差し替える。 */
const resolveFromCatalog = (
  entry: MessageEntry,
  substitutions: readonly string[],
): string => {
  const { placeholders } = entry;
  if (placeholders === undefined) return entry.message;
  return entry.message.replace(
    /\$([A-Za-z0-9_]+)\$/g,
    (whole, name: string) => {
      const placeholder = placeholders[name];
      if (placeholder === undefined) return whole;
      const index = Number.parseInt(placeholder.content.replace("$", ""), 10);
      return substitutions[index - 1] ?? "";
    },
  );
};

/**
 * `_locales/<locale>/messages.json` の 1 キーを解決する。
 *
 * パラメータを含む文言は断片の連結ではなく `placeholders` を使った完結した
 * 1 文としてカタログ側に定義する (`features.md` 7.3)。ここで文字列を
 * 組み立てないこと。
 */
export const t = (key: string, ...substitutions: string[]): string => {
  const runtime = globalThis.chrome?.i18n;
  if (runtime !== undefined) return runtime.getMessage(key, substitutions);

  const entry = fallbackCatalog?.[key];
  if (entry === undefined) return "";
  return resolveFromCatalog(entry, substitutions);
};
