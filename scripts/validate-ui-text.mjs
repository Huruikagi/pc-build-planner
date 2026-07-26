import { execFileSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createScanner, SyntaxKind } from "./typescript-scanner.mjs";

/**
 * @typedef {{ readonly path: string, readonly source: string }} SourceFile
 * @typedef {{ readonly path: string, readonly line: number, readonly rule: string }} UiTextViolation
 */

// Excluded by design (see design.md's UiTextGuard Implementation Notes):
// - src/ui-messages/catalog/ (both ja/ and en/): the catalog IS the
//   natural-language source of truth.
// - src/ui-messages/languages.ts: holds each language's own-language endonym
//   (e.g. "日本語"), which is language-independent data, not translated text.
// - src/features/product-capture/locale/: Japanese-locale capture-assist
//   data (category keywords, price tokens), not display text (7.5).
// - tests/: test fixtures and titles legitimately contain natural language.
// - src/domain/, src/persistence/: no display layer, never render literal text.
//
// Deliberately NOT excluded (removed from this list, 7.5): category-hint.ts
// and normalizer.ts now only hold matching/parsing logic that references the
// locale/ data above — a reintroduced Japanese literal there is a mistake,
// not translated data, so it must fail this check (see TS_SCAN_TARGETS below).
const NATURAL_LANGUAGE = /[぀-ヿ㐀-鿿]/;
const ENGLISH_DISPLAY_TEXT = /[A-Za-z]/;
const USER_PERCEIVABLE_ATTRIBUTES = new Set([
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "aria-braillelabel",
  "aria-brailleroledescription",
  "placeholder",
  "title",
  "alt",
]);

const TS_SCAN_TARGETS = [
  { glob: /(?:^|\/)features\/[^/]+\/view\.tsx$/, label: "view" },
  { glob: /(?:^|\/)features\/[^/]+\/registration\.ts$/, label: "registration" },
  { glob: /(?:^|\/)features\/[^/]+\/react-root\.tsx$/, label: "react-root" },
  { glob: /(?:^|\/)application-shell\/.+\.tsx?$/, label: "application-shell" },
  {
    glob: /(?:^|\/)features\/product-capture\/(?:category-hint|normalizer)\.ts$/,
    label: "product-capture-locale-logic",
  },
];

const CSS_SCAN_TARGETS = [
  /(?:^|\/)features\/[^/]+\/styles\.css$/,
  /(?:^|\/)application-shell\/.+\.css$/,
];

const STRING_LITERAL_KINDS = new Set([
  SyntaxKind.StringLiteral,
  SyntaxKind.NoSubstitutionTemplateLiteral,
  SyntaxKind.TemplateHead,
  SyntaxKind.TemplateMiddle,
  SyntaxKind.TemplateTail,
]);

/** @param {string} source @param {number} offset @returns {number} */
const lineOf = (source, offset) => source.slice(0, offset).split("\n").length;

/**
 * Plain sequential `scan()` cannot tell a `}` that closes a template-literal
 * `${...}` hole from an ordinary object/block `}` — it needs `reScanTemplateToken`
 * called at exactly that position to resume lexing the template's raw text
 * instead of ordinary tokens. Without this, a `}` inside e.g. `` `id={`${x}-error`}` ``
 * silently desyncs the scanner and the rest of the file (routinely hundreds of
 * lines in JSX-heavy view files) is swallowed into one bogus template token,
 * hiding every later literal and import from the scan. This walks the file
 * once, tracking open-brace depth per pending template hole so the matching
 * close brace is re-scanned in template mode instead of treated as a normal token.
 * @param {string} source @returns {{ kind: number, text: string, value: string, fullStart: number, start: number, end: number }[]}
 */
const tokenize = (source) => {
  const scanner = createScanner(true, undefined, source);
  const tokens = [];
  /** @type {number[]} */
  const templateHoleDepths = [];
  let kind = scanner.scan();
  while (kind !== SyntaxKind.EndOfFile) {
    const top = templateHoleDepths.length - 1;
    if (kind === SyntaxKind.TemplateHead) templateHoleDepths.push(0);
    else if (kind === SyntaxKind.OpenBraceToken && top >= 0)
      templateHoleDepths[top] = (templateHoleDepths[top] ?? 0) + 1;
    else if (kind === SyntaxKind.CloseBraceToken && top >= 0) {
      if (templateHoleDepths[top] === 0) {
        kind = scanner.reScanTemplateToken(false);
        tokens.push({
          kind,
          text: scanner.getTokenText(),
          value: scanner.getTokenValue(),
          fullStart: scanner.getTokenFullStart(),
          start: scanner.getTokenStart(),
          end: scanner.getTokenEnd(),
        });
        if (kind === SyntaxKind.TemplateTail) templateHoleDepths.pop();
        kind = scanner.scan();
        continue;
      }
      templateHoleDepths[top] = (templateHoleDepths[top] ?? 0) - 1;
    }
    tokens.push({
      kind,
      text: scanner.getTokenText(),
      value: scanner.getTokenValue(),
      fullStart: scanner.getTokenFullStart(),
      start: scanner.getTokenStart(),
      end: scanner.getTokenEnd(),
    });
    kind = scanner.scan();
  }
  return tokens;
};

/** @param {SourceFile} file @returns {UiTextViolation[]} */
const findLiteralViolations = ({ path, source }) => {
  const violations = [];
  for (const token of tokenize(source)) {
    if (!STRING_LITERAL_KINDS.has(token.kind)) continue;
    if (NATURAL_LANGUAGE.test(token.value))
      violations.push({
        path,
        line: lineOf(source, token.fullStart),
        rule: "no-natural-language-literal",
      });
  }
  return violations;
};

const CATALOG_IMPORT = /ui-messages\/catalog\/index(?:\.js|\.ts)?$/;

/** @param {SourceFile} file @returns {UiTextViolation[]} */
const findCatalogImportViolations = ({ path, source }) => {
  if (!/(?:^|\/)view\.tsx$/.test(path)) return [];
  const violations = [];
  let previousKind = SyntaxKind.Unknown;
  for (const token of tokenize(source)) {
    if (
      token.kind === SyntaxKind.StringLiteral &&
      (previousKind === SyntaxKind.FromKeyword ||
        previousKind === SyntaxKind.ImportKeyword) &&
      CATALOG_IMPORT.test(token.value)
    )
      violations.push({
        path,
        line: lineOf(source, token.fullStart),
        rule: "no-direct-catalog-import",
      });
    previousKind = token.kind;
  }
  return violations;
};

const ATTRIBUTE_SELECTOR_VALUE =
  /\[\s*([\w-]+)[^\]{}]*?=\s*(?:"([^"]*)"|'([^']*)'|([\w-]+))[^\]]*\]/g;

/** @param {SourceFile} file @returns {UiTextViolation[]} */
const findCssSelectorViolations = ({ path, source }) => {
  const violations = [];
  for (const match of source.matchAll(ATTRIBUTE_SELECTOR_VALUE)) {
    const attribute = (match[1] ?? "").toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (
      NATURAL_LANGUAGE.test(value) ||
      (USER_PERCEIVABLE_ATTRIBUTES.has(attribute) &&
        ENGLISH_DISPLAY_TEXT.test(value))
    )
      violations.push({
        path,
        line: lineOf(source, match.index ?? 0),
        rule: "no-natural-language-attribute-selector",
      });
  }
  return violations;
};

const AST_HELPER = fileURLToPath(
  new URL("./validate-ui-text-ast.mjs", import.meta.url),
);

const JSX_ENTITY = /&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);/gi;

/** @param {SourceFile} file @returns {UiTextViolation[]} */
const findJsxEntityViolations = ({ path, source }) =>
  [...source.matchAll(JSX_ENTITY)].map((match) => ({
    path,
    line: lineOf(source, match.index ?? 0),
    rule: "no-jsx-entity",
  }));

/** @param {readonly SourceFile[]} sources @returns {UiTextViolation[]} */
const findJsxViolationsInVanillaNode = (sources) => {
  if (sources.length === 0) return [];
  const output = execFileSync(process.execPath, [AST_HELPER], {
    encoding: "utf8",
    input: JSON.stringify(sources),
    windowsHide: true,
  });
  return JSON.parse(output);
};

/** @param {readonly SourceFile[]} sources @returns {UiTextViolation[]} */
export const findUiTextViolations = (sources) => {
  const violations = [];
  const tsxTargets = sources.filter((file) => {
    const normalized = file.path.replaceAll("\\", "/");
    return (
      /\.tsx$/.test(normalized) &&
      TS_SCAN_TARGETS.some(({ glob }) => glob.test(normalized))
    );
  });
  const jsxEntityViolations = tsxTargets.flatMap(findJsxEntityViolations);
  const entityPaths = new Set(
    jsxEntityViolations.map((violation) => violation.path),
  );
  violations.push(
    ...findJsxViolationsInVanillaNode(
      tsxTargets.filter((file) => !entityPaths.has(file.path)),
    ),
    ...jsxEntityViolations,
  );
  for (const file of sources) {
    const normalized = file.path.replaceAll("\\", "/");
    if (
      TS_SCAN_TARGETS.some(({ glob }) => glob.test(normalized)) &&
      !entityPaths.has(file.path)
    ) {
      violations.push(...findLiteralViolations(file));
      violations.push(...findCatalogImportViolations(file));
    }
    if (CSS_SCAN_TARGETS.some((glob) => glob.test(normalized)))
      violations.push(...findCssSelectorViolations(file));
  }
  return violations;
};

/** @param {string} root @returns {Promise<SourceFile[]>} */
const collectSources = async (root) => {
  const entry = await stat(root).catch(() => undefined);
  if (entry === undefined)
    throw new Error(`ui-text scan root does not exist: ${root}`);
  if (entry.isFile())
    return /\.(?:ts|tsx|css)$/.test(root)
      ? [{ path: root, source: await readFile(root, "utf8") }]
      : [];
  const sources = [];
  for (const child of await readdir(root, { withFileTypes: true })) {
    const childPath = `${root}/${child.name}`;
    if (child.isDirectory()) sources.push(...(await collectSources(childPath)));
    else if (/\.(?:ts|tsx|css)$/.test(child.name))
      sources.push({
        path: childPath,
        source: await readFile(childPath, "utf8"),
      });
  }
  return sources;
};

/** @param {readonly string[]} roots */
export const validateUiTextRoots = async (roots) =>
  findUiTextViolations((await Promise.all(roots.map(collectSources))).flat());

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const roots = process.argv.slice(2);
  if (roots.length === 0)
    throw new Error("at least one ui-text scan root is required");
  const violations = await validateUiTextRoots(roots);
  if (violations.length > 0) {
    for (const violation of violations)
      console.error(`${violation.path}:${violation.line}: ${violation.rule}`);
    process.exitCode = 1;
  }
}
