import { readdir, readFile, stat } from "node:fs/promises";
import { posix } from "node:path";
import { pathToFileURL } from "node:url";
import {
  isClassDeclaration,
  isFunctionDeclaration,
  isIdentifier,
  isInterfaceDeclaration,
  isTypeAliasDeclaration,
  isVariableDeclaration,
} from "typescript/unstable/ast/is";
import { withTypeScriptAsts } from "./typescript-ast.mjs";
import { createScanner, SyntaxKind } from "./typescript-scanner.mjs";

const PACKAGE_PREFIX = "@pc-build-planner/local-data";
const DECLARED_ENTRIES = new Set([
  PACKAGE_PREFIX,
  `${PACKAGE_PREFIX}/chrome`,
  `${PACKAGE_PREFIX}/backup`,
]);

/** @param {string} path */
const normalize = (path) => path.replaceAll("\\", "/").replace(/^\.\//, "");

/** @param {string} source @returns {string[]} */
const importedSpecifiers = (source) => {
  const scanner = createScanner(true, undefined, source);
  /** @type {{ kind: number, value: string }[]} */
  const tokens = [];
  for (
    let kind = scanner.scan();
    kind !== SyntaxKind.EndOfFile;
    kind = scanner.scan()
  )
    tokens.push({ kind, value: scanner.getTokenValue() });
  return tokens.flatMap((token, index) => {
    if (token.kind !== SyntaxKind.StringLiteral) return [];
    const previous = tokens.slice(Math.max(0, index - 5), index);
    return previous.some(({ kind }) =>
      [SyntaxKind.ImportKeyword, SyntaxKind.FromKeyword].includes(kind),
    )
      ? [token.value]
      : [];
  });
};

/** @param {string} path @returns {"core" | "chrome" | "backup" | undefined} */
const packageLayer = (path) => {
  const normalized = normalize(path);
  if (!/^packages\/local-data\/src\//.test(normalized)) return undefined;
  if (/^packages\/local-data\/src\/chrome\//.test(normalized)) return "chrome";
  if (/^packages\/local-data\/src\/backup\//.test(normalized)) return "backup";
  return "core";
};

/** @param {string} path @param {string} specifier */
const dependencyKind = (path, specifier) => {
  const normalizedSpecifier = specifier.replaceAll("\\", "/");
  if (
    normalizedSpecifier === "react" ||
    normalizedSpecifier.startsWith("react/")
  )
    return "react";
  if (
    normalizedSpecifier === "react-dom" ||
    normalizedSpecifier.startsWith("react-dom/")
  )
    return "dom";
  if (normalizedSpecifier === `${PACKAGE_PREFIX}/chrome`) return "chrome";
  if (normalizedSpecifier === `${PACKAGE_PREFIX}/backup`) return "backup";
  if (!normalizedSpecifier.startsWith(".")) return undefined;
  const resolved = posix.normalize(
    posix.join(posix.dirname(normalize(path)), normalizedSpecifier),
  );
  if (resolved.includes("local-data/src/chrome/")) return "chrome";
  if (resolved.includes("local-data/src/backup/")) return "backup";
  if (!resolved.startsWith("packages/local-data/")) return "product";
  return undefined;
};

/** @param {import("typescript/unstable/ast").SourceFile} sourceFile */
const declaredNames = (sourceFile) => {
  const names = new Set();
  /** @param {import("typescript/unstable/ast").Node} node */
  const visit = (node) => {
    const name =
      isClassDeclaration(node) ||
      isInterfaceDeclaration(node) ||
      isTypeAliasDeclaration(node) ||
      isFunctionDeclaration(node) ||
      isVariableDeclaration(node)
        ? node.name
        : undefined;
    if (name !== undefined && isIdentifier(name)) names.add(name.text);
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return names;
};

/** @param {string} path @param {string} source @param {import("typescript/unstable/ast").SourceFile} sourceFile @returns {string[]} */
const ownershipRules = (path, source, sourceFile) => {
  if (!/^packages\/local-data\/(?:src|tests)\//.test(normalize(path)))
    return [];
  const rules = [];
  const names = declaredNames(sourceFile);
  if (names.has("ProductLocalDataAdapter"))
    rules.push("local-data-no-product-local-data-adapter-ownership");
  if (names.has("ProductBackupAdapter"))
    rules.push("local-data-no-product-backup-adapter-ownership");
  if (
    [...names].some((name) =>
      /^(?:Product\w*Composition|createProduct\w*Composition)$/.test(name),
    )
  )
    rules.push("local-data-no-product-composition-ownership");
  if (
    /(?:^|\/)e2e(?:\/|\.)/i.test(normalize(path)) ||
    importedSpecifiers(source).includes("@playwright/test")
  )
    rules.push("local-data-no-e2e-ownership");
  return rules;
};

/**
 * @typedef {{ readonly path: string, readonly source: string }} SourceFile
 * @typedef {{ readonly path: string, readonly rule: string }} BoundaryViolation
 */

/** @param {readonly SourceFile[]} sources @returns {BoundaryViolation[]} */
export const findLocalDataBoundaryViolations = (sources) =>
  withTypeScriptAsts(sources, (asts) =>
    sources.flatMap(({ path, source }, index) => {
      const sourceFile = asts[index];
      if (sourceFile === undefined)
        throw new Error(`TypeScript AST unavailable for ${path}`);
      const rules = new Set(ownershipRules(path, source, sourceFile));
      const layer = packageLayer(path);
      for (const specifier of importedSpecifiers(source)) {
        // Package tests may intentionally assert module-resolution failures. The
        // ownership rules still apply there; import-graph rules describe shipped
        // source and workspace consumers.
        const isPackageTest = /^packages\/local-data\/tests\//.test(
          normalize(path),
        );
        if (isPackageTest) continue;
        if (specifier.startsWith(`${PACKAGE_PREFIX}/`)) {
          if (/\/src(?:\/|$)/.test(specifier))
            rules.add("local-data-no-src-deep-import");
          else if (/\/dist(?:\/|$)/.test(specifier))
            rules.add("local-data-no-dist-deep-import");
          else if (!DECLARED_ENTRIES.has(specifier))
            rules.add("local-data-no-undeclared-subpath");
        }
        const dependency = dependencyKind(path, specifier);
        if (layer === "core" && dependency === "chrome")
          rules.add("local-data-core-no-chrome-dependency");
        if (layer === "core" && dependency === "backup")
          rules.add("local-data-core-no-backup-dependency");
        if (layer === "core" && dependency === "product")
          rules.add("local-data-core-no-product-dependency");
        if (layer === "chrome" && dependency === "product")
          rules.add("local-data-chrome-no-product-dependency");
        if (layer === "backup" && dependency === "chrome")
          rules.add("local-data-backup-no-chrome-dependency");
        if (layer === "backup" && dependency === "dom")
          rules.add("local-data-backup-no-dom-dependency");
        if (layer === "backup" && dependency === "react")
          rules.add("local-data-backup-no-react-dependency");
        if (layer === "backup" && dependency === "product")
          rules.add("local-data-backup-no-product-dependency");
      }
      return [...rules].map((rule) => ({ path, rule }));
    }),
  );

/** @param {string} root @returns {Promise<SourceFile[]>} */
const collectSources = async (root) => {
  const entry = await stat(root).catch(() => undefined);
  if (entry === undefined)
    throw new Error(`local-data boundary scan root does not exist: ${root}`);
  if (entry.isFile())
    return /\.[cm]?[jt]sx?$/.test(root)
      ? [{ path: normalize(root), source: await readFile(root, "utf8") }]
      : [];
  const sources = [];
  for (const child of await readdir(root, { withFileTypes: true })) {
    if (["dist", "node_modules"].includes(child.name)) continue;
    const childPath = `${root}/${child.name}`;
    if (child.isDirectory()) sources.push(...(await collectSources(childPath)));
    else if (/\.[cm]?[jt]sx?$/.test(child.name))
      sources.push({
        path: normalize(childPath),
        source: await readFile(childPath, "utf8"),
      });
  }
  return sources;
};

/** @param {readonly string[]} roots @returns {Promise<BoundaryViolation[]>} */
export const validateLocalDataBoundaryRoots = async (roots) =>
  findLocalDataBoundaryViolations(
    (await Promise.all(roots.map(collectSources))).flat(),
  );

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const roots = process.argv.slice(2);
  if (roots.length === 0)
    throw new Error("at least one local-data boundary scan root is required");
  const violations = await validateLocalDataBoundaryRoots(roots);
  for (const violation of violations)
    console.error(`${violation.path}: ${violation.rule}`);
  if (violations.length > 0) process.exitCode = 1;
}
