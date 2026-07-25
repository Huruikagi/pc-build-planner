// @ts-nocheck 文言リテラル再混入の機械検査を検証する。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  findUiTextViolations,
  validateUiTextRoots,
} from "../../scripts/validate-ui-text.mjs";

test("view・registration・react-root・application-shellの日本語literalを拒否する", () => {
  const violations = findUiTextViolations([
    {
      path: "src/features/mock/view.tsx",
      source: 'export const x = "未分類";',
    },
    {
      path: "src/features/mock/registration.ts",
      source: 'export const label = "候補管理";',
    },
    {
      path: "src/features/mock/react-root.tsx",
      source: 'export const heading = "取り込み確認";',
    },
    {
      path: "src/application-shell/mock.ts",
      source: 'export const message = "メンテナンス中";',
    },
  ]);

  assert.deepEqual(
    violations.map(({ path, rule }) => `${path}: ${rule}`),
    [
      "src/features/mock/view.tsx: no-natural-language-literal",
      "src/features/mock/registration.ts: no-natural-language-literal",
      "src/features/mock/react-root.tsx: no-natural-language-literal",
      "src/application-shell/mock.ts: no-natural-language-literal",
    ],
  );
});

test("テンプレートリテラルの穴({})に囲まれた日本語も、入れ子の穴も見逃さない", () => {
  const violations = findUiTextViolations([
    {
      path: "src/features/mock/view.tsx",
      // Fixture TS source being scanned as text, not a real template string.
      source:
        "export const label = `${prefix}未分類${suffix}`;\n" +
        "export const nested = `${a + `${b}未確認`}末尾`;",
    },
  ]);

  assert.equal(violations.length, 3);
  assert.deepEqual(
    violations.map(({ rule }) => rule),
    [
      "no-natural-language-literal",
      "no-natural-language-literal",
      "no-natural-language-literal",
    ],
  );
});

test("テンプレートの穴を閉じる`}`の後段にある実コードを見失わない", () => {
  // A prior implementation naively called scan() in a loop without re-scanning
  // the `}` that closes a template hole, which desynced the lexer and silently
  // swallowed everything after it (including this later literal) as one bogus
  // template token — this must not regress.
  const violations = findUiTextViolations([
    {
      path: "src/features/mock/view.tsx",
      // Fixture TS source being scanned as text, not a real template string.
      source:
        "export const id = `${field}-error`;\n" +
        'export const laterLiteral = "未分類";',
    },
  ]);

  assert.deepEqual(
    violations.map(({ rule }) => rule),
    ["no-natural-language-literal"],
  );
});

test("英語のみのliteralとfixtureファイルを対象外のまま通す", () => {
  const violations = findUiTextViolations([
    { path: "src/features/mock/view.tsx", source: 'export const x = "ok";' },
    {
      path: "src/features/product-capture/category-hint.ts",
      source: 'export const x = "未分類";',
    },
    {
      path: "src/ui-messages/catalog/shell.ts",
      source: 'export const shell = { loading: "読み込み中です" };',
    },
    { path: "tests/features/mock.test.ts", source: 'assert.ok("未分類");' },
    { path: "src/domain/model.ts", source: 'export const x = "未分類";' },
  ]);

  assert.deepEqual(violations, []);
});

test("view.tsxからのカタログ直接importを拒否する", () => {
  const violations = findUiTextViolations([
    {
      path: "src/features/mock/view.tsx",
      source: 'import { MESSAGES } from "../../ui-messages/catalog/index.js";',
    },
    {
      path: "src/features/mock/registration.ts",
      source: 'import { MESSAGES } from "../../ui-messages/catalog/index.js";',
    },
  ]);

  assert.deepEqual(
    violations.map(({ path, rule }) => `${path}: ${rule}`),
    ["src/features/mock/view.tsx: no-direct-catalog-import"],
  );
});

test("スタイルの属性セレクタ値に含まれる日本語を拒否する", () => {
  const violations = findUiTextViolations([
    {
      path: "src/features/mock/styles.css",
      source: '.mock [aria-label="未分類"] { color: red; }',
    },
    {
      path: "src/application-shell/mock.css",
      source: '.shell [data-region="読み込み中"] { color: blue; }',
    },
    {
      path: "src/features/mock/styles.css",
      source: '.mock [data-region="candidate-list"] { color: green; }',
    },
  ]);

  assert.deepEqual(
    violations.map(({ path, rule }) => `${path}: ${rule}`),
    [
      "src/features/mock/styles.css: no-natural-language-attribute-selector",
      "src/application-shell/mock.css: no-natural-language-attribute-selector",
    ],
  );
});

test("存在しないscan rootをfail closedに拒否する", async () => {
  await assert.rejects(
    validateUiTextRoots(["src/features/__missing__"]),
    /ui-text scan root does not exist/,
  );
});

test("実際のsrc配下は違反ゼロで通る", async () => {
  const violations = await validateUiTextRoots([
    "src/features",
    "src/application-shell",
  ]);
  assert.deepEqual(violations, []);
});

test("package.jsonがvalidate:ui-textをvalidate:ciのpnpm testより前段へ組み込む", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  assert.match(
    packageJson.scripts["validate:ui-text"],
    /validate-ui-text\.mjs/,
  );
  const ci = packageJson.scripts["validate:ci"];
  assert.match(ci, /validate:ui-text/);
  assert.ok(
    ci.indexOf("validate:ui-text") < ci.indexOf("pnpm test"),
    "validate:ui-textはpnpm testより前段でなければならない",
  );
});
