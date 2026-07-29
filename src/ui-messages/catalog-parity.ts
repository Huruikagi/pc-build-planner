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

export const V03_SETTINGS_KEYS = [
  "nav.settings",
  "settings.title",
  "settings.language.title",
  "settings.language.description",
  "settings.backupRestore.title",
  "settings.backupRestore.description",
] as const;

export const V03_SHELL_KEYS = [
  "shell.transientActivationFailed",
  "shell.transientActivationExpired",
  "shell.settingsRecoveryLoading",
  "shell.settingsRecoveryStartupFailed",
] as const;

export const V03_CAPTURE_KEYS = [
  "capture.errors.permission-lost",
  "capture.newGenerationHint",
  "capture.handoffRetainedNotice",
  "capture.retryHandoffAction",
] as const;

export const V03_BILINGUAL_HINT_KEYS = [
  "shell.settingsRecoveryLoading",
  "shell.settingsRecoveryStartupFailed",
] as const;

export type CatalogParityIssue = Readonly<{
  code:
    | "missing-key"
    | "excess-key"
    | "required-key-missing"
    | "placeholder-mismatch"
    | "bilingual-hint-missing";
  key: string;
}>;

export interface CatalogParityOptions {
  readonly requiredKeys?: readonly string[];
  readonly bilingualHintKeys?: readonly string[];
}

const definitionTexts = (definition: MessageDefinition): readonly string[] =>
  typeof definition === "string"
    ? [definition]
    : Object.values(definition.forms);

const placeholderNames = (definition: MessageDefinition): readonly string[] => {
  const names = new Set<string>();
  for (const text of definitionTexts(definition)) {
    for (const match of text.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)) {
      names.add(match[1] as string);
    }
  }
  return [...names].sort();
};

/** Runtime parity gate used by fixtures and CI before legacy navigation removal. */
export const validateCatalogParity = (
  source: Readonly<Record<string, MessageDefinition>>,
  target: Readonly<Record<string, MessageDefinition>>,
  options: CatalogParityOptions = {},
): readonly CatalogParityIssue[] => {
  const issues: CatalogParityIssue[] = [];
  const sourceKeys = new Set(Object.keys(source));
  const targetKeys = new Set(Object.keys(target));

  for (const key of sourceKeys) {
    if (!targetKeys.has(key)) issues.push({ code: "missing-key", key });
  }
  for (const key of targetKeys) {
    if (!sourceKeys.has(key)) issues.push({ code: "excess-key", key });
  }
  for (const key of sourceKeys) {
    const sourceDefinition = source[key];
    const targetDefinition = target[key];
    if (sourceDefinition === undefined || targetDefinition === undefined) {
      continue;
    }
    if (
      placeholderNames(sourceDefinition).join("\0") !==
      placeholderNames(targetDefinition).join("\0")
    ) {
      issues.push({ code: "placeholder-mismatch", key });
    }
  }

  for (const key of options.requiredKeys ?? []) {
    if (!sourceKeys.has(key) || !targetKeys.has(key)) {
      issues.push({ code: "required-key-missing", key });
    }
  }
  for (const key of options.bilingualHintKeys ?? []) {
    for (const catalog of [source, target]) {
      const definition = catalog[key];
      if (
        definition === undefined ||
        definitionTexts(definition).some(
          (text) => !text.includes("設定") || !text.includes("Settings"),
        )
      ) {
        issues.push({ code: "bilingual-hint-missing", key });
        break;
      }
    }
  }

  return issues;
};
