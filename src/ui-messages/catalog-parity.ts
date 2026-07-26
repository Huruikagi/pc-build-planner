import type { MESSAGES, MessageKey } from "./catalog/ja/index.js";
import type {
  DefinitionAt,
  MessageDefinition,
  MessageKeyOf,
  MessageNamespace,
} from "./contracts.js";

/** ソース言語（日本語）のカタログ。キー集合と各キーの定義形の源。 */
type SourceCatalog = typeof MESSAGES;

/** 平坦化した言語別カタログ。キーの欠落は型エラーになる。 */
export type LocalizedCatalog = {
  readonly [K in MessageKey]: MessageDefinition;
};

/** 名前空間の入れ子のまま受ける入力形。平坦化前の宣言に使う。 */
export type LocalizedCatalogInput = MessageNamespace;

/**
 * 入れ子の名前空間を `LocalizedCatalog` の平坦なキー別カタログへ型レベルで変換する。
 * 実行時の `flattenNamespace` に対応する型レベル操作であり、値は生成しない。
 */
export type FlattenLocalizedCatalog<T extends LocalizedCatalogInput> = {
  readonly [K in MessageKeyOf<T> & MessageKey]: DefinitionAt<T, K>;
};

/** 不一致のキーだけを union として残す。全て一致していれば never。 */
export type CatalogParityViolations<TTarget extends LocalizedCatalog> = {
  [K in MessageKey]: TTarget[K] extends DefinitionAt<SourceCatalog, K>
    ? never
    : K;
}[MessageKey];

/** 各言語カタログの宣言直後に置くコンパイル時表明。 */
export type AssertCatalogParity<TTarget extends LocalizedCatalog> = [
  CatalogParityViolations<TTarget>,
] extends [never]
  ? true
  : CatalogParityViolations<TTarget>;
