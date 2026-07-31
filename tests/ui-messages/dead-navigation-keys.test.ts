import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import test from "node:test";
import { type Node, SyntaxKind } from "typescript/unstable/ast";
import {
  isArrayLiteralExpression,
  isBinaryExpression,
  isCallExpression,
  isNoSubstitutionTemplateLiteral,
  isParenthesizedExpression,
  isPropertyAccessExpression,
  isSpreadElement,
  isStringLiteral,
} from "typescript/unstable/ast/is";
import { withTypeScriptAsts } from "../../scripts/typescript-ast.mjs";

const SCAN_ROOTS = ["src/ui-messages/catalog", "src", "tests", "e2e"] as const;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const DEAD_MESSAGE_KEYS = [
  ["nav", "productCapture"].join("."),
  ["nav", "backupRestore"].join("."),
  ["shell", "transientActivationUnavailable"].join("."),
] as const;
const THIS_FILE = "tests/ui-messages/dead-navigation-keys.test.ts";

const evaluateConstantString = (expression: Node): string | undefined => {
  if (
    isStringLiteral(expression) ||
    isNoSubstitutionTemplateLiteral(expression)
  ) {
    return expression.text;
  }
  if (isParenthesizedExpression(expression)) {
    return evaluateConstantString(expression.expression);
  }
  if (
    isBinaryExpression(expression) &&
    expression.operatorToken.kind === SyntaxKind.PlusToken
  ) {
    const left = evaluateConstantString(expression.left);
    const right = evaluateConstantString(expression.right);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  if (
    !isCallExpression(expression) ||
    expression.questionDotToken !== undefined ||
    expression.arguments.length !== 1 ||
    !isPropertyAccessExpression(expression.expression) ||
    expression.expression.questionDotToken !== undefined ||
    expression.expression.name.text !== "join" ||
    !isArrayLiteralExpression(expression.expression.expression)
  ) {
    return undefined;
  }
  const separatorExpression = expression.arguments[0];
  if (separatorExpression === undefined) return undefined;
  const separator = evaluateConstantString(separatorExpression);
  if (separator === undefined) return undefined;
  const values: string[] = [];
  for (const element of expression.expression.expression.elements) {
    if (isSpreadElement(element)) return undefined;
    const value = evaluateConstantString(element);
    if (value === undefined) return undefined;
    values.push(value);
  }
  return values.join(separator);
};

type Source = { readonly path: string; readonly source: string };

const exactConstantKeysByPath = (
  sources: readonly Source[],
  keys: readonly string[],
): ReadonlyMap<string, ReadonlySet<string>> =>
  withTypeScriptAsts(sources, (asts) => {
    const matches = new Map<string, ReadonlySet<string>>();
    for (const [index, ast] of asts.entries()) {
      const found = new Set<string>();
      const visit = (node: Node): void => {
        const value = evaluateConstantString(node);
        if (value !== undefined) {
          if (keys.includes(value)) found.add(value);
          return;
        }
        node.forEachChild(visit);
      };
      visit(ast);
      const path = sources[index]?.path;
      if (path !== undefined) matches.set(path, found);
    }
    return matches;
  });

const sourceFiles = async (root: string): Promise<readonly string[]> => {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return SOURCE_EXTENSIONS.has(extname(entry.name)) ? [path] : [];
    }),
  );
  return files.flat();
};

test("廃止message keyはcatalogとconsumerに残らない", async () => {
  const files = [
    ...new Set((await Promise.all(SCAN_ROOTS.map(sourceFiles))).flat()),
  ];
  const violations: string[] = [];

  const sources: Source[] = [];
  for (const file of files) {
    const normalizedPath = relative(".", file).replaceAll("\\", "/");
    if (normalizedPath === THIS_FILE) continue;
    sources.push({
      path: normalizedPath,
      source: await readFile(file, "utf8"),
    });
  }
  const matches = exactConstantKeysByPath(sources, DEAD_MESSAGE_KEYS);
  for (const { path } of sources) {
    for (const key of DEAD_MESSAGE_KEYS) {
      if (matches.get(path)?.has(key)) violations.push(`${path}: ${key}`);
    }
  }

  assert.deepEqual(violations, []);
});

test("dead-key gateは静的に完成するexact keyだけを拒否する", () => {
  const key = "nav.productCapture";
  const positive = [
    'const value = "nav.productCapture";',
    "const value = `nav.productCapture`;",
    'const value = "nav." + "product" + `Capture`;',
    "const value = ['nav', 'productCapture'].join('.');",
    'const value = "nav.\\u{70}roductCapture";',
    'const value = "shell.transientActivationUnavailable";',
  ];
  const negative = [
    '// const value = "nav.productCapture";',
    '/* const value = "nav.productCapture"; */',
    'const value = /"nav.productCapture"/;',
    'const value = "nav.productCapture.suffix";',
    'const value = "nav.productCapture" + ".suffix";',
    "const value = ['nav', 'productCapture', 'suffix'].join('.');",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: parser fixture intentionally contains a dynamic template.
    "const value = `nav.${segment}`;",
    'const value = "nav." + segment;',
  ];
  const sources = [...positive, ...negative].map((source, index) => ({
    path: `fixture-${index}.ts`,
    source,
  }));
  const matches = exactConstantKeysByPath(sources, [
    key,
    "shell.transientActivationUnavailable",
  ]);
  for (const [index, source] of positive.entries()) {
    const expected =
      index === positive.length - 1
        ? "shell.transientActivationUnavailable"
        : key;
    assert.equal(
      matches.get(`fixture-${index}.ts`)?.has(expected),
      true,
      source,
    );
  }
  for (const [index, source] of negative.entries()) {
    const path = `fixture-${positive.length + index}.ts`;
    assert.equal(matches.get(path)?.has(key), false, source);
  }
});
