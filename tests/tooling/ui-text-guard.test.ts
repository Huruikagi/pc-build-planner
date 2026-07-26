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

test("JSXの英語テキスト・直接文字列child・利用者向け属性を拒否する", () => {
  const violations = findUiTextViolations([
    {
      path: "src/features/mock/view.tsx",
      source: `
        export const View = () => (
          <section title="Project settings">
            Save
            {"Cancel"}
            <input aria-label="Name" placeholder="PC name" />
            <img alt="Preview" />
          </section>
        );
      `,
    },
  ]);

  assert.deepEqual(
    violations.map(({ rule }) => rule),
    [
      "no-natural-language-jsx-attribute",
      "no-natural-language-jsx-text",
      "no-natural-language-jsx-expression-child",
      "no-natural-language-jsx-attribute",
      "no-natural-language-jsx-attribute",
      "no-natural-language-jsx-attribute",
    ],
  );
});

test("fragment・nested fragment・conditional/array内の英語UI文言を拒否する", () => {
  const violations = findUiTextViolations([
    {
      path: "src/features/mock/view.tsx",
      source: `
        const FragmentView = () => <>Save<><span title="Details">Cancel</span></></>;
        const ConditionalView = ({ ready }) => ready ? <p>Continue</p> : null;
        const views = [<button aria-label="Remove" key="remove" />, <p key="done">Done</p>];
      `,
    },
  ]);

  assert.deepEqual(
    violations.map(({ rule }) => rule),
    [
      "no-natural-language-jsx-text",
      "no-natural-language-jsx-attribute",
      "no-natural-language-jsx-text",
      "no-natural-language-jsx-text",
      "no-natural-language-jsx-attribute",
      "no-natural-language-jsx-text",
    ],
  );
});

test("JSX式コンテナ内のnested JSXと条件式の表示文字列を拒否する", () => {
  const violations = findUiTextViolations([
    {
      path: "src/features/mock/view.tsx",
      source: `
        const NestedConditional = ({ ok }) => <div>{ok ? <span>Save</span> : <span>Cancel</span>}</div>;
        const NestedArray = () => <div>{[<span>Save</span>]}</div>;
        const LogicalAnd = ({ ok }) => ok && <span>Save</span>;
        const LogicalOr = ({ value }) => value || <span>Fallback</span>;
        const Nullish = ({ value }) => value ?? <span>Fallback</span>;
        const StringConditional = ({ ok }) => <div>{ok ? "Save" : "Cancel"}</div>;
      `,
    },
  ]);

  assert.deepEqual(
    violations.map(({ rule }) => rule),
    [
      "no-natural-language-jsx-text",
      "no-natural-language-jsx-text",
      "no-natural-language-jsx-text",
      "no-natural-language-jsx-text",
      "no-natural-language-jsx-text",
      "no-natural-language-jsx-text",
      "no-natural-language-jsx-expression-child",
      "no-natural-language-jsx-expression-child",
    ],
  );
});

test("JSX childと利用者向け属性のtemplate・conditional・文字列連結を拒否する", () => {
  const violations = findUiTextViolations([
    {
      path: "src/features/mock/view.tsx",
      source: `
        const TemplateChild = () => <div>{\`Save\`}</div>;
        const ConditionalTemplate = ({ ok }) => <div>{ok ? \`Save\` : \`Cancel\`}</div>;
        const ConcatenatedChild = ({ name }) => <div>{"Save " + name}</div>;
        const TemplateAttribute = () => <button title={\`Save\`} />;
        const ConditionalAttribute = ({ ok }) => <button title={ok ? "Save" : "Cancel"} />;
      `,
    },
  ]);

  assert.deepEqual(
    violations.map(({ rule }) => rule),
    [
      "no-natural-language-jsx-expression-child",
      "no-natural-language-jsx-expression-child",
      "no-natural-language-jsx-expression-child",
      "no-natural-language-jsx-expression-child",
      "no-natural-language-jsx-attribute",
      "no-natural-language-jsx-attribute",
      "no-natural-language-jsx-attribute",
    ],
  );
});

test("補間templateと連鎖したfallbackの全表示候補を拒否する", () => {
  const violations = findUiTextViolations([
    {
      path: "src/features/mock/view.tsx",
      source: `
        const TemplateChild = ({ name }) => <div>{\`Save ${"${" + "name}"} now\`}</div>;
        const TemplateAttribute = ({ name }) => <button title={\`Save ${"${" + "name}"} now\`} />;
        const LogicalOr = ({ primary, secondary }) => <div>{primary || "Fallback" || secondary}</div>;
        const Nullish = ({ primary, secondary }) => <div>{primary ?? "Fallback" ?? secondary}</div>;
      `,
    },
  ]);

  assert.deepEqual(
    violations.map(({ rule }) => rule),
    [
      "no-natural-language-jsx-expression-child",
      "no-natural-language-jsx-expression-child",
      "no-natural-language-jsx-attribute",
      "no-natural-language-jsx-attribute",
      "no-natural-language-jsx-expression-child",
      "no-natural-language-jsx-expression-child",
    ],
  );
});

test("追加の利用者向け属性を拒否しコード属性は許可する", () => {
  const violations = findUiTextViolations([
    {
      path: "src/features/mock/view.tsx",
      source: `
        const View = ({ code }) => (
          <>
            <div aria-description="Project details" aria-valuetext={\`Level ${"${" + "code}"}\`} />
            <input type="button" value="Save" />
            <option label="Recommended">recommended</option>
            <input type="text" value="ready" name="projectName" />
            <button data-action="save-project" value="save-project" />
          </>
        );
      `,
    },
  ]);

  assert.deepEqual(
    violations.map(({ rule }) => rule),
    [
      "no-natural-language-jsx-attribute",
      "no-natural-language-jsx-attribute",
      "no-natural-language-jsx-attribute",
      "no-natural-language-jsx-attribute",
      "no-natural-language-jsx-text",
    ],
  );
});

test("root JSX・式属性・spread属性・label属性の英語表示候補を拒否する", () => {
  const violations = findUiTextViolations([
    {
      path: "src/features/mock/view.tsx",
      source: `
        export default <div>Save</div>;
        const Submit = () => <input type={"submit"} value="Save" />;
        const Spread = () => <button {...{"aria-label": "Save"}} />;
        const Track = () => <track label="English" />;
        const Group = () => <optgroup label="Options" />;
      `,
    },
  ]);

  assert.deepEqual(
    violations.map(({ rule }) => rule),
    [
      "no-natural-language-jsx-text",
      "no-natural-language-jsx-attribute",
      "no-natural-language-jsx-attribute",
      "no-natural-language-jsx-attribute",
      "no-natural-language-jsx-attribute",
    ],
  );
});

test("識別子・callback・変数spreadを介する英語UI文言をfail-closedで拒否する", () => {
  const violations = findUiTextViolations([
    {
      path: "src/features/mock/view.tsx",
      source: `
        const SAVE = "Save";
        const LOWER = "save";
        const attrs = { "aria-label": "Save" };
        const Direct = () => <div>{SAVE}</div>;
        const Callback = ({ items }) => <div>{items.map(() => "Save")}</div>;
        const CallbackLower = ({ items }) => <div>{items.map(() => "save")}</div>;
        const Component = () => <Field label="Save" />;
        const Spread = () => <button {...attrs} />;
        const DynamicInput = ({ kind }) => <input type={kind} value="Save" />;
      `,
    },
  ]);

  assert.deepEqual(
    violations.map(({ rule }) => rule),
    [
      "no-natural-language-english-literal",
      "no-natural-language-english-literal",
      "no-natural-language-english-literal",
      "no-natural-language-english-literal",
      "no-natural-language-english-literal",
      "no-natural-language-jsx-attribute",
      "no-natural-language-jsx-attribute",
    ],
  );
});

test("return・名前変数・object・assignment・array callback経路もlowercase文言を拒否する", () => {
  const violations = findUiTextViolations([
    {
      path: "src/features/mock/view.tsx",
      source: `
        function getLabel() { return "save"; }
        const displayName = "save";
        const item = { text: "save" };
        let label;
        label = "save";
        const rows = [{ text: "save" }];
        const View = () => (
          <>
            <span>{getLabel()}</span>
            <span>{displayName}</span>
            <span>{item.text}</span>
            <span>{label}</span>
            {rows.map((row) => <span>{row.text}</span>)}
          </>
        );
      `,
    },
  ]);

  assert.deepEqual(
    violations.map(({ rule }) => rule),
    [
      "no-natural-language-english-literal",
      "no-natural-language-english-literal",
      "no-natural-language-english-literal",
      "no-natural-language-english-literal",
      "no-natural-language-english-literal",
    ],
  );
});

test("区切りproperty・Title Case binding・String constructor・表示selector・JSX entityを拒否する", () => {
  const violations = findUiTextViolations([
    {
      path: "src/features/property/view.tsx",
      source: `
        const item = { text: "save-project" };
        const View = () => <span>{item.text}</span>;
      `,
    },
    {
      path: "src/features/binding/view.tsx",
      source: `
        const action = "Save";
        const View = () => <span>{action}</span>;
      `,
    },
    {
      path: "src/features/constructor/view.tsx",
      source: `
        const text = new String("Save");
        const View = () => <span>{text}</span>;
      `,
    },
    {
      path: "src/features/selector/view.tsx",
      source: `
        const target = document.querySelector('[aria-label="Save"]');
        const View = () => <span>{target?.textContent}</span>;
      `,
    },
    {
      path: "src/features/entity/view.tsx",
      source: "const View = () => <span>&#83;ave</span>;",
    },
  ]);

  assert.deepEqual(
    violations.map(({ rule }) => rule),
    [
      "no-natural-language-english-literal",
      "no-natural-language-english-literal",
      "no-natural-language-english-literal",
      "no-natural-language-english-literal",
      "no-jsx-entity",
    ],
  );
});

test("JSX式内の比較・関数呼び出し・オブジェクトのコード文字列は許可する", () => {
  const violations = findUiTextViolations([
    {
      path: "src/features/mock/view.tsx",
      source: `
        const View = ({ value }) => (
          <div>
            {value === "ready" ? messages("candidate.ready") : null}
            {items.map((item) => ({ kind: "candidate", id: item.id }))}
          </div>
        );
      `,
    },
  ]);

  assert.deepEqual(violations, []);
});

test("英語のコード・診断・importと安定識別子は対象外のまま通す", () => {
  const violations = findUiTextViolations([
    {
      path: "src/features/mock/view.tsx",
      source: `
        import { message } from "../../ui-messages/public.js";
        const diagnosticCode = "startup_failed";
        const action = "save-project";
        const messageKey = "candidate.form.save";
        const featureId = "candidate-management";
        const fieldName = "name";
        export const View = () => (
          <button
            className="primary-action"
            id="save-button"
            data-action="save-project"
            data-region="candidate-list"
          >
            {message(messageKey)}
          </button>
        );
      `,
    },
    {
      path: "src/features/product-capture/locale/ja-category-keywords.ts",
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

test("category-hint.ts・normalizer.tsは推定ロジック側として日本語literalを拒否し、locale/データは除外のまま通す(7.5)", () => {
  const violations = findUiTextViolations([
    {
      path: "src/features/product-capture/category-hint.ts",
      source: 'export const leak = "未分類";',
    },
    {
      path: "src/features/product-capture/normalizer.ts",
      source: 'export const leak = "円";',
    },
    {
      path: "src/features/product-capture/locale/ja-category-keywords.ts",
      source: 'export const JA_CATEGORY_KEYWORDS = [["cpu", ["プロセッサ"]]];',
    },
    {
      path: "src/features/product-capture/locale/ja-price-tokens.ts",
      source: 'export const YEN_SYMBOL_CURRENCY = "JPY";',
    },
  ]);

  assert.deepEqual(
    violations.map(({ path, rule }) => `${path}: ${rule}`),
    [
      "src/features/product-capture/category-hint.ts: no-natural-language-literal",
      "src/features/product-capture/normalizer.ts: no-natural-language-literal",
    ],
  );
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

test("スタイルの利用者向け英語属性値を拒否し安定識別子を許可する", () => {
  const violations = findUiTextViolations([
    {
      path: "src/features/mock/styles.css",
      source: `
        .mock [aria-label="Save"] { color: red; }
        .mock [ARIA-LABEL="Save"] { color: red; }
        .mock [title="Project settings"] { color: blue; }
        .mock [data-region="candidate-list"] { color: green; }
        .mock [data-action="save-project"] { color: green; }
        .mock [type="file"] { color: green; }
      `,
    },
  ]);

  assert.deepEqual(
    violations.map(({ rule }) => rule),
    [
      "no-natural-language-attribute-selector",
      "no-natural-language-attribute-selector",
      "no-natural-language-attribute-selector",
    ],
  );
});

test("スタイルの引用符なし利用者向け英語属性値を拒否する", () => {
  const violations = findUiTextViolations([
    {
      path: "src/features/mock/styles.css",
      source: ".mock [aria-label=Save] { color: red; }",
    },
  ]);

  assert.deepEqual(
    violations.map(({ rule }) => rule),
    ["no-natural-language-attribute-selector"],
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
