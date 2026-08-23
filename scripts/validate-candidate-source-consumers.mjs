import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SyntaxKind } from "typescript/unstable/ast";
import {
  isBinaryExpression,
  isCallExpression,
  isElementAccessExpression,
  isExportDeclaration,
  isIdentifier,
  isImportDeclaration,
  isImportTypeNode,
  isLiteralTypeNode,
  isNamedImports,
  isNamespaceImport,
  isNoSubstitutionTemplateLiteral,
  isPropertyAccessExpression,
  isStringLiteral,
  isVariableDeclaration,
} from "typescript/unstable/ast/is";
import { withTypeScriptAsts } from "./typescript-ast.mjs";

/** @typedef {{ readonly path: string, readonly source: string }} SourceFile */
/** @typedef {{ readonly path: string, readonly rule: string }} BoundaryViolation */

export const candidateSourceConsumerScanRoots = Object.freeze([
  "src/candidate-sources",
  "src/features/candidate-management/public.ts",
  "tests/tooling/candidate-source-editor-consumer.ts",
  "tests/tooling/source-price-candidate-sources-consumer.ts",
  "tests/tooling/duplicate-product-candidate-sources-consumer.ts",
]);

/** @param {import("typescript/unstable/ast").Node} node @param {(node: import("typescript/unstable/ast").Node) => void} visit */
const walk = (node, visit) => {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
};
/** @typedef {{ readonly kind: "import" | "export" | "import-type" | "dynamic-import", readonly value: string | undefined }} ModuleSpecifier */
/** @param {import("typescript/unstable/ast").SourceFile} ast @returns {ModuleSpecifier[]} */
const moduleSpecifiers = (ast) => {
  /** @type {Map<string, import("typescript/unstable/ast").Expression>} */
  const declarations = new Map();
  walk(ast, (node) => {
    if (
      isVariableDeclaration(node) &&
      isIdentifier(node.name) &&
      node.initializer
    )
      declarations.set(node.name.text, node.initializer);
  });
  /** @type {Map<string, string>} */
  const values = new Map();
  /** @param {import("typescript/unstable/ast").Node} node @returns {string | undefined} */
  const evaluate = (node) => {
    if (isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node))
      return node.text.replaceAll("\\", "/");
    if (isIdentifier(node)) return values.get(node.text);
    if (
      isBinaryExpression(node) &&
      node.operatorToken.kind === SyntaxKind.PlusToken
    ) {
      const left = evaluate(node.left);
      const right = evaluate(node.right);
      return left === undefined || right === undefined
        ? undefined
        : left + right;
    }
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const [name, expression] of declarations)
      if (!values.has(name)) {
        const value = evaluate(expression);
        if (value !== undefined) {
          values.set(name, value);
          changed = true;
        }
      }
  }
  /** @type {ModuleSpecifier[]} */
  const specifiers = [];
  walk(ast, (node) => {
    let expression;
    /** @type {ModuleSpecifier["kind"] | undefined} */
    let kind;
    if (isImportDeclaration(node)) {
      expression = node.moduleSpecifier;
      kind = "import";
    } else if (isExportDeclaration(node)) {
      expression = node.moduleSpecifier;
      kind = "export";
    } else if (isImportTypeNode(node) && isLiteralTypeNode(node.argument)) {
      expression = node.argument.literal;
      kind = "import-type";
    } else if (
      isCallExpression(node) &&
      node.expression.kind === SyntaxKind.ImportKeyword
    ) {
      expression = node.arguments[0];
      kind = "dynamic-import";
    }
    if (expression !== undefined && kind !== undefined)
      specifiers.push({ kind, value: evaluate(expression) });
  });
  return specifiers;
};

/** @param {string | undefined} value */
const candidateSourcePublicModule = (value) =>
  value !== undefined && /candidate-sources\/public(?:\.js|\.ts)?$/.test(value);

/** @param {import("typescript/unstable/ast").SourceFile} ast */
const usesCandidateSourceOwnedIdentity = (ast) => {
  /** @type {Set<string>} */
  const directImports = new Set();
  /** @type {Set<string>} */
  const namespaces = new Set();
  /** @type {Map<string, import("typescript/unstable/ast").Expression>} */
  const declarations = new Map();
  walk(ast, (node) => {
    if (
      isVariableDeclaration(node) &&
      isIdentifier(node.name) &&
      node.initializer
    )
      declarations.set(node.name.text, node.initializer);
    if (!isImportDeclaration(node)) return;
    const module = isStringLiteral(node.moduleSpecifier)
      ? node.moduleSpecifier.text.replaceAll("\\", "/")
      : undefined;
    if (!candidateSourcePublicModule(module)) return;
    const bindings = node.importClause?.namedBindings;
    if (bindings === undefined) return;
    if (isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    else if (isNamedImports(bindings))
      for (const element of bindings.elements) {
        const imported = element.propertyName?.text ?? element.name.text;
        if (imported === "identifyCandidateSourceUrl")
          directImports.add(element.name.text);
      }
  });
  if (directImports.size > 0) return true;

  /** @param {import("typescript/unstable/ast").Node} node @param {Set<string>} [seen] */
  const resolvesNamespace = (node, seen = new Set()) => {
    if (!isIdentifier(node)) return false;
    if (namespaces.has(node.text)) return true;
    if (seen.has(node.text)) return false;
    const initializer = declarations.get(node.text);
    if (initializer === undefined) return false;
    return resolvesNamespace(initializer, new Set([...seen, node.text]));
  };
  /** @param {import("typescript/unstable/ast").Node} node @param {Set<string>} [seen] @returns {string | undefined} */
  const stringValue = (node, seen = new Set()) => {
    if (isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node))
      return node.text;
    if (isIdentifier(node)) {
      if (seen.has(node.text)) return undefined;
      const initializer = declarations.get(node.text);
      return initializer === undefined
        ? undefined
        : stringValue(initializer, new Set([...seen, node.text]));
    }
    if (
      isBinaryExpression(node) &&
      node.operatorToken.kind === SyntaxKind.PlusToken
    ) {
      const left = stringValue(node.left, seen);
      const right = stringValue(node.right, seen);
      return left === undefined || right === undefined
        ? undefined
        : left + right;
    }
  };
  let violation = false;
  walk(ast, (node) => {
    if (
      isPropertyAccessExpression(node) &&
      resolvesNamespace(node.expression) &&
      node.name.text === "identifyCandidateSourceUrl"
    )
      violation = true;
    if (isElementAccessExpression(node) && resolvesNamespace(node.expression)) {
      const member = stringValue(node.argumentExpression);
      if (member === undefined || member === "identifyCandidateSourceUrl")
        violation = true;
    }
  });
  return violation;
};

/** @param {string} path @param {string | undefined} target @returns {string | undefined} */
const ruleFor = (path, target) => {
  const source = path.replaceAll("\\", "/");
  if (target === undefined)
    return "candidate-source-dynamic-import-fail-closed";
  if (
    /candidate-sources\//.test(target) &&
    !/(?:^|\/)candidate-sources\/public(?:\.js|\.ts)?$/.test(target)
  )
    return "candidate-sources-public-entry-only";
  if (/features\/source-price-refresh\//.test(target))
    return "source-consumer-no-price-workflow";
  if (/features\/duplicate-product-merge\//.test(target))
    return "source-consumer-no-product-identity";
  if (
    /persistence\/(?!public(?:\.js|\.ts)?$)|domain\/(?!public(?:\.js|\.ts)?$)/.test(
      target,
    )
  )
    return "source-consumer-no-foundation-internals";
  if (/features\/candidate-management\/(?!public(?:\.js|\.ts)?$)/.test(target))
    return "source-consumer-no-candidate-internals";
  if (
    /application-shell\/(?:application-composition|feature-contribution-catalog|runtime-bootstrap)/.test(
      target,
    )
  )
    return "source-consumer-no-shell-composition";
  if (
    /src\/candidate-sources\//.test(source) &&
    /(?:features|application-shell)\//.test(target)
  )
    return "candidate-sources-core-no-feature-cycle";
};

/** @param {readonly SourceFile[]} sources @returns {BoundaryViolation[]} */
export const findCandidateSourceConsumerViolations = (sources) => {
  return withTypeScriptAsts(sources, (asts) => {
    /** @type {BoundaryViolation[]} */
    const violations = [];
    sources.forEach(({ path, source }, index) => {
      /** @type {Set<string>} */
      const rules = new Set();
      const specifiers = asts[index] ? moduleSpecifiers(asts[index]) : [];
      for (const { value } of specifiers) {
        const rule = ruleFor(path, value);
        if (rule !== undefined) rules.add(rule);
      }
      if (asts[index] && usesCandidateSourceOwnedIdentity(asts[index]))
        rules.add("source-price-consumer-no-owned-source-identity");
      const importsCandidateProxy = specifiers.some(
        ({ value }) =>
          value !== undefined &&
          /features\/candidate-management\/public(?:\.js|\.ts)?$/.test(value),
      );
      if (importsCandidateProxy) {
        if (/\bManagementError\b/u.test(source))
          rules.add("source-price-consumer-no-management-error");
        else rules.add("source-price-consumer-no-candidate-source-proxy");
      }
      if (
        specifiers.some(
          ({ value }) =>
            value !== undefined &&
            /features\/source-price-refresh\/public(?:\.js|\.ts)?$/.test(value),
        ) &&
        /\b(?:normalizeSourcePageUrl|sameSourcePageUrl|createStoredSourceLocator)\b/u.test(
          source,
        )
      ) {
        rules.delete("source-consumer-no-price-workflow");
        rules.add("source-price-consumer-no-owned-source-identity");
      }
      if (
        specifiers.some(
          ({ value }) =>
            value !== undefined && /domain\/public(?:\.js|\.ts)?$/.test(value),
        ) &&
        /\b(?:mapFoundationError|FoundationError)\b/u.test(source)
      )
        rules.add("source-price-consumer-no-foundation-error-mapper");
      if (
        /features\/candidate-management\/public\.ts$/.test(
          path.replaceAll("\\", "/"),
        ) &&
        specifiers.some(
          ({ kind, value }) =>
            kind === "export" &&
            value !== undefined &&
            /(?:^|\/)candidate-sources\//.test(value),
        )
      )
        rules.add("candidate-management-no-source-re-export");
      for (const rule of rules) violations.push({ path, rule });
    });
    return violations;
  });
};

/** @param {readonly string[]} roots @returns {Promise<SourceFile[]>} */
const readRoots = async (roots) => {
  /** @type {SourceFile[]} */
  const sources = [];
  for (const root of roots) {
    let info;
    try {
      info = await stat(root);
    } catch {
      throw new Error(`candidate source scan root does not exist: ${root}`);
    }
    if (info.isFile())
      sources.push({ path: root, source: await readFile(root, "utf8") });
    else
      for (const entry of await readdir(root, { recursive: true })) {
        const path = `${root}/${entry}`.replaceAll("\\", "/");
        if (/\.[cm]?[jt]sx?$/.test(path) && (await stat(path)).isFile())
          sources.push({ path, source: await readFile(path, "utf8") });
      }
  }
  return sources;
};

/** @param {readonly SourceFile[]} sources @returns {BoundaryViolation[]} */
const cycleViolations = (sources) => {
  const known = new Map(
    sources.map(({ path }) => [
      resolve(path).replaceAll("\\", "/").toLowerCase(),
      path,
    ]),
  );
  /** @type {Map<string, string[]>} */
  const edges = new Map();
  withTypeScriptAsts(sources, (asts) =>
    sources.forEach(({ path }, index) => {
      const from = resolve(path).replaceAll("\\", "/").toLowerCase();
      const targets = (
        asts[index] ? moduleSpecifiers(asts[index]) : []
      ).flatMap(({ value: specifier }) => {
        if (specifier === undefined || !specifier.startsWith(".")) return [];
        const base = normalize(resolve(dirname(path), specifier)).replaceAll(
          "\\",
          "/",
        );
        const target = [
          base,
          base.replace(/\.js$/, ".ts"),
          base.replace(/\.js$/, ".tsx"),
          `${base}/index.ts`,
        ].find((item) => known.has(item.toLowerCase()));
        return target ? [target.toLowerCase()] : [];
      });
      edges.set(from, targets);
    }),
  );
  /** @type {BoundaryViolation[]} */
  const violations = [];
  for (const start of edges.keys()) {
    const queue = [...(edges.get(start) ?? [])];
    const seen = new Set();
    while (queue.length) {
      const current = queue.shift();
      if (!current || seen.has(current)) continue;
      if (current === start) {
        violations.push({
          path: known.get(start) ?? start,
          rule: "candidate-source-dependency-cycle",
        });
        break;
      }
      seen.add(current);
      queue.push(...(edges.get(current) ?? []));
    }
  }
  return violations;
};

/** @param {readonly string[]} roots @returns {Promise<BoundaryViolation[]>} */
export const validateCandidateSourceConsumerRoots = async (roots) => {
  const sources = await readRoots(roots);
  return [
    ...findCandidateSourceConsumerViolations(sources),
    ...cycleViolations(sources),
  ];
};

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  const roots = process.argv.slice(2);
  const violations = await validateCandidateSourceConsumerRoots(roots);
  for (const { path, rule } of violations) console.error(`${path}: ${rule}`);
  if (violations.length > 0) process.exitCode = 1;
}
