import assert from "node:assert/strict";
import test from "node:test";

import { EN_MESSAGES } from "../../src/ui-messages/catalog/en/index.js";
import { MESSAGES } from "../../src/ui-messages/catalog/ja/index.js";
import type {
  AssertCatalogParity,
  FlattenLocalizedCatalog,
} from "../../src/ui-messages/catalog-parity.js";
import {
  V03_BILINGUAL_HINT_KEYS,
  V03_CAPTURE_KEYS,
  V03_SETTINGS_KEYS,
  V03_SHELL_KEYS,
  validateCatalogParity,
} from "../../src/ui-messages/catalog-parity.js";
import type { MessageDefinition } from "../../src/ui-messages/contracts.js";
import { formatMessage } from "../../src/ui-messages/format.js";
import { type MessageKey, resolverFor } from "../../src/ui-messages/public.js";
import { flattenNamespace } from "../../src/ui-messages/resolver.js";

// Compile-time guarantee (1.2): dropping a single key from a target catalog
// makes it fail `LocalizedCatalog`'s mapped-type coverage, so it can no
// longer be passed to `AssertCatalogParity` at all — this is the "欠落は
// マップ型の網羅性で検出する" mechanism from design.md's CatalogParityTypes
// component. Excess keys are separately caught by `satisfies` at each
// catalog's own declaration site (see `catalog/{ja,en}/index.ts`).
type _CompleteFlatCatalog = FlattenLocalizedCatalog<typeof MESSAGES>;
type _CatalogMissingASingleKey = Omit<_CompleteFlatCatalog, "common.save">;
// @ts-expect-error "common.save" is missing, so this no longer satisfies LocalizedCatalog.
type _AssertFailsOnDroppedKey = AssertCatalogParity<_CatalogMissingASingleKey>;
void (0 as unknown as _AssertFailsOnDroppedKey);

test("完全なカタログはAssertCatalogParityがtrueに解決される", () => {
  type Assertion = AssertCatalogParity<_CompleteFlatCatalog>;
  const assertion: Assertion = true;
  assert.equal(assertion, true);
});

/** Every `{name}` placeholder appearing across all forms of a definition. */
const placeholdersOf = (definition: MessageDefinition): ReadonlySet<string> => {
  const texts =
    typeof definition === "string"
      ? [definition]
      : Object.values(definition.forms);
  const names = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)) {
      names.add(match[1] as string);
    }
  }
  return names;
};

/**
 * The ordered quantity-selector contract. Languages without plural forms use
 * the source sentence's ordered count placeholders for the same contract.
 */
const selectorsOf = (definition: MessageDefinition): readonly string[] => {
  if (typeof definition !== "string" && definition.selectors !== undefined) {
    return definition.selectors;
  }
  const text =
    typeof definition === "string" ? definition : definition.forms.other;
  return [...text.matchAll(/\{([A-Za-z][A-Za-z0-9]*Count)\}/g)].map(
    (match) => match[1] as string,
  );
};

const ja = flattenNamespace(MESSAGES) as Readonly<
  Record<string, MessageDefinition>
>;
const en = flattenNamespace(EN_MESSAGES) as Readonly<
  Record<string, MessageDefinition>
>;

const parityIssues = (
  source: Readonly<Record<string, MessageDefinition>>,
  target: Readonly<Record<string, MessageDefinition>>,
) =>
  validateCatalogParity(source, target, {
    requiredKeys: [
      ...V03_SETTINGS_KEYS,
      ...V03_SHELL_KEYS,
      ...V03_CAPTURE_KEYS,
    ],
    bilingualHintKeys: V03_BILINGUAL_HINT_KEYS,
  });

const textsOf = (definition: MessageDefinition): readonly string[] =>
  typeof definition === "string"
    ? [definition]
    : Object.values(definition.forms);

test("ja/enはキー集合が一致する", () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ja).sort());
});

test("利用者向け対象名は日本語・英語ともパーツ表記に統一する", () => {
  for (const [key, definition] of Object.entries(ja)) {
    for (const text of textsOf(definition)) {
      assert.doesNotMatch(text, /候補/, key);
    }
  }
  for (const [key, definition] of Object.entries(en)) {
    for (const text of textsOf(definition)) {
      assert.doesNotMatch(text, /\bcandidates?\b/i, key);
    }
  }
});

test("価格更新のmenu・状態・全failure・回復案内をtyped resolverで両言語解決する", () => {
  const keysOf = <T extends object>(value: T) =>
    Object.keys(value) as (keyof T & string)[];
  const keys = [
    "sourcePriceRefresh.menuLabel",
    "sourcePriceRefresh.runningStatus",
    "sourcePriceRefresh.succeededStatus",
    "sourcePriceRefresh.failedStatus",
    ...keysOf(MESSAGES.sourcePriceRefresh.errors).map(
      (kind) => `sourcePriceRefresh.errors.${kind}` as const,
    ),
    ...keysOf(MESSAGES.sourcePriceRefresh.guidance).map(
      (kind) => `sourcePriceRefresh.guidance.${kind}` as const,
    ),
  ] satisfies readonly MessageKey[];

  for (const language of ["ja", "en"] as const) {
    const resolve = resolverFor(language);
    for (const key of keys)
      assert.notEqual(resolve(key), "", `${language}:${key}`);
  }
});

test("ja/enの全キーでプレースホルダ名の集合が一致する(4.2)", () => {
  for (const key of Object.keys(ja)) {
    const jaPlaceholders = [
      ...placeholdersOf(ja[key] as MessageDefinition),
    ].sort();
    const enPlaceholders = [
      ...placeholdersOf(en[key] as MessageDefinition),
    ].sort();
    assert.deepEqual(enPlaceholders, jaPlaceholders, key);
  }
});

test("candidate source操作・種別・再訪・失敗の全message keyを両言語で提供する", () => {
  const keys = [
    "candidate.sources.label",
    "candidate.sources.kind.retail",
    "candidate.sources.kind.manufacturer",
    "candidate.sources.primary",
    "candidate.sources.add",
    "candidate.sources.remove",
    "candidate.sources.open",
    "candidate.sources.errors.replacementRequired",
    "candidate.sources.errors.invalidUrl",
    "candidate.sources.errors.openFailed",
    "candidate.sources.errors.runtimeUnavailable",
  ];
  for (const key of keys) {
    assert.equal(typeof ja[key], "string", key);
    assert.equal(typeof en[key], "string", key);
  }
});

test("重複候補判断の根拠・確信度・action・安定failure keyを両言語で提供する", () => {
  const keys = [
    "candidate.duplicate.confidence.high",
    "candidate.duplicate.confidence.supporting",
    "candidate.duplicate.evidence.modelNumber",
    "candidate.duplicate.evidence.manufacturerName",
    "candidate.duplicate.actions.saveNew",
    "candidate.duplicate.actions.merge",
    "candidate.duplicate.actions.retry",
    "candidate.duplicate.errors.query",
    "candidate.duplicate.errors.conflict",
    "candidate.duplicate.errors.ambiguous",
    "candidate.duplicate.errors.source",
    "candidate.duplicate.errors.storage",
    "candidate.duplicate.errors.stale",
    "candidate.duplicate.errors.unexpected",
  ];
  for (const key of keys) {
    assert.equal(typeof ja[key], "string", key);
    assert.equal(typeof en[key], "string", key);
    assert.equal(placeholdersOf(ja[key] as MessageDefinition).size, 0, key);
  }
});

test("英語の復元完了通知は実カタログで各件数に応じた単複表現を返す", () => {
  const resolver = resolverFor("en");
  const counts = [0, 1, 2] as const;

  for (const projectCount of counts) {
    for (const partCount of counts) {
      for (const currentBuildCount of counts) {
        const projectNoun = projectCount === 1 ? "project" : "projects";
        const partNoun = partCount === 1 ? "part" : "parts";
        const currentBuildNoun =
          currentBuildCount === 1 ? "current build" : "current builds";
        assert.equal(
          resolver("backup.restoreCompleted", {
            projectCount,
            partCount,
            currentBuildCount,
          }),
          `Restore complete (${projectNoun}: ${projectCount}, ${partNoun}: ${partCount}, ${currentBuildNoun}: ${currentBuildCount}).`,
          `${projectCount}|${partCount}|${currentBuildCount}`,
        );
      }
    }
  }
});

test("ja/enの複数数量キーはselector名・順序が一致する", () => {
  for (const key of Object.keys(ja)) {
    const jaSelectors = selectorsOf(ja[key] as MessageDefinition);
    const enSelectors = selectorsOf(en[key] as MessageDefinition);
    assert.deepEqual(enSelectors, jaSelectors, key);
  }
});

test("英語の単複フォームはcountの0/1/2に対して期待どおりのフォームを返す", () => {
  // No key in this catalog currently requires PluralDefinition (the
  // Japanese catalog never needs plural forms, and no English value has
  // required one either), so this fixes the *mechanism* using a definition
  // shaped the same way a future plural key would be, per design.md's
  // `formatMessage` contract (count 0/1 -> zero/one if defined, else other).
  const items = {
    forms: { other: "{count} items", one: "{count} item" },
  } as const;
  assert.equal(formatMessage(items, { count: 0 }), "0 items");
  assert.equal(formatMessage(items, { count: 1 }), "1 item");
  assert.equal(formatMessage(items, { count: 2 }), "2 items");
});

test("v0.3 gateはexact keyと旧backup navigation撤去を固定する", () => {
  assert.deepEqual(Object.keys(MESSAGES), [
    "common",
    "category",
    "persistenceError",
    "nav",
    "shell",
    "settings",
    "candidate",
    "build",
    "compatibility",
    "capture",
    "backup",
    "sourcePriceRefresh",
  ]);
  assert.deepEqual(Object.keys(EN_MESSAGES), Object.keys(MESSAGES));
  assert.deepEqual(V03_SETTINGS_KEYS, [
    "nav.settings",
    "settings.title",
    "settings.language.title",
    "settings.language.description",
    "settings.backupRestore.title",
    "settings.backupRestore.description",
  ]);
  assert.deepEqual(V03_SHELL_KEYS, [
    "shell.transientActivationFailed",
    "shell.transientActivationExpired",
    "shell.settingsRecoveryLoading",
    "shell.settingsRecoveryStartupFailed",
  ]);
  assert.deepEqual(V03_CAPTURE_KEYS, [
    "capture.errors.permission-lost",
    "capture.newGenerationHint",
    "capture.handoffRetainedNotice",
    "capture.retryHandoffAction",
  ]);
  assert.deepEqual(parityIssues(ja, en), []);
});

test("v0.3移行前gateはキー欠落と余剰を拒否する", () => {
  const missing = { ...en };
  delete missing["settings.title"];
  assert.ok(
    parityIssues(ja, missing).some(
      (issue) => issue.code === "missing-key" && issue.key === "settings.title",
    ),
  );

  const excess = { ...en, "settings.unapproved": "Unapproved" };
  assert.ok(
    parityIssues(ja, excess).some(
      (issue) =>
        issue.code === "excess-key" && issue.key === "settings.unapproved",
    ),
  );
});

test("v0.3移行前gateは全formのplaceholder不一致を拒否する", () => {
  const source = {
    ...ja,
    "capture.fixture": {
      forms: { one: "{item}件", other: "{count}件の{item}" },
    },
  };
  const target = {
    ...en,
    "capture.fixture": {
      forms: { one: "{count} item", other: "{count} items" },
    },
  };
  assert.ok(
    parityIssues(source, target).some(
      (issue) =>
        issue.code === "placeholder-mismatch" &&
        issue.key === "capture.fixture",
    ),
  );
});

test("v0.3移行前gateは固定二言語hintの片言語欠落を拒否する", () => {
  const broken = {
    ...en,
    "shell.settingsRecoveryLoading":
      "Loading. Change the display language in Settings.",
  };
  assert.ok(
    parityIssues(ja, broken).some(
      (issue) =>
        issue.code === "bilingual-hint-missing" &&
        issue.key === "shell.settingsRecoveryLoading",
    ),
  );
});
