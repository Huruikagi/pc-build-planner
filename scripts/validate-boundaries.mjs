import { readdir, readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  NodeFlags as AstNodeFlags,
  SyntaxKind as AstSyntaxKind,
} from "typescript/unstable/ast";
import {
  isAsExpression,
  isBinaryExpression,
  isBindingElement,
  isCallExpression,
  isComputedPropertyName,
  isElementAccessExpression,
  isExportDeclaration,
  isIdentifier,
  isImportDeclaration,
  isImportTypeNode,
  isLiteralTypeNode,
  isNamedExports,
  isNamedImports,
  isNonNullExpression,
  isNoSubstitutionTemplateLiteral,
  isParenthesizedExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isSatisfiesExpression,
  isShorthandPropertyAssignment,
  isStringLiteral,
  isVariableDeclaration,
} from "typescript/unstable/ast/is";
import { withTypeScriptAsts } from "./typescript-ast.mjs";

// Query suffixes keep repository test resolve hooks from rewriting dependency .js files to .ts.
const scannerModule = "../node_modules/typescript/dist/ast/scanner.js?boundary";
const syntaxKindModule =
  "../node_modules/typescript/dist/enums/syntaxKind.js?boundary";
/** @type {typeof import("typescript/unstable/ast/scanner").createScanner} */
const createScanner = (await import(scannerModule)).createScanner;
/** @type {typeof import("typescript/unstable/ast").SyntaxKind} */
const SyntaxKind = (await import(syntaxKindModule)).SyntaxKind;

const LOCK_NAME = "pc-build-planner:local-data-root-write";

/**
 * @typedef {{ readonly path: string, readonly source: string }} SourceFile
 * @typedef {{ readonly path: string, readonly rule: string }} BoundaryViolation
 */

/** @typedef {{ readonly kind: number, readonly text: string, readonly value: string }} Token */

/** @param {string} source @returns {Token[]} */
const tokenize = (source) => {
  const scanner = createScanner(true, undefined, source);
  const tokens = [];
  for (
    let kind = scanner.scan();
    kind !== SyntaxKind.EndOfFile;
    kind = scanner.scan()
  )
    tokens.push({
      kind,
      text: scanner.getTokenText(),
      value: scanner.getTokenValue(),
    });
  return tokens;
};

/** @param {readonly Token[]} tokens @param {number} start */
const foldedString = (tokens, start) => {
  if (tokens[start]?.kind !== SyntaxKind.StringLiteral) return undefined;
  let value = tokens[start]?.value ?? "";
  let end = start + 1;
  while (
    tokens[end]?.kind === SyntaxKind.PlusToken &&
    tokens[end + 1]?.kind === SyntaxKind.StringLiteral
  ) {
    value += tokens[end + 1]?.value ?? "";
    end += 2;
  }
  return { value, end };
};

/** @param {readonly Token[]} tokens @param {number} start @param {Map<string, string>} aliases */
const memberPath = (tokens, start, aliases) => {
  const first = tokens[start];
  if (first?.kind !== SyntaxKind.Identifier) return undefined;
  if (first === undefined) return undefined;
  let value = aliases.get(first.value) ?? first.value;
  let end = start + 1;
  while (end < tokens.length) {
    if (
      (tokens[end]?.kind === SyntaxKind.DotToken ||
        tokens[end]?.kind === SyntaxKind.QuestionDotToken) &&
      tokens[end + 1]?.kind === SyntaxKind.Identifier
    ) {
      value += `.${tokens[end + 1]?.value}`;
      end += 2;
      continue;
    }
    if (tokens[end]?.kind === SyntaxKind.OpenBracketToken) {
      const member = foldedString(tokens, end + 1);
      if (
        member === undefined ||
        tokens[member.end]?.kind !== SyntaxKind.CloseBracketToken
      )
        break;
      value += `.${member.value}`;
      end = member.end + 1;
      continue;
    }
    break;
  }
  return { value, end };
};

/** @param {string} specifier */
const isForbiddenImport = (specifier) => {
  const normalized = specifier.replaceAll("\\", "/");
  const match = normalized.match(/\/(domain|persistence|runtime)\/(.+)$/);
  if (match === null) return false;
  return (
    match[1] === "runtime" || !/^public(?:\.js|\.ts)?$/.test(match[2] ?? "")
  );
};

/** @param {string} specifier */
const isForbiddenApplicationShellFeatureImport = (specifier) => {
  const normalized = specifier.replaceAll("\\", "/");
  const match = normalized.match(/(?:^|\/)features\/[^/]+\/(.+)$/);
  if (match === null) return false;
  return !/^(?:public|feature-contribution)(?:\.js|\.ts)?$/.test(
    match[1] ?? "",
  );
};

/** @param {string} sourcePath @param {string} specifier */
const isForbiddenCrossFeatureImport = (sourcePath, specifier) => {
  const normalizedSource = sourcePath.replaceAll("\\", "/");
  const owner = normalizedSource.match(/(?:^|\/)features\/([^/]+)\//)?.[1];
  if (owner === undefined) return false;
  const normalizedSpecifier = specifier.replaceAll("\\", "/");
  const target = normalizedSpecifier.match(
    /(?:^|\/)features\/([^/]+)\/(.+)$|(?:^|\/)\.\.\/([^/]+)\/(.+)$/,
  );
  const targetFeature = target?.[1] ?? target?.[3];
  const targetPath = target?.[2] ?? target?.[4];
  return (
    targetFeature !== undefined &&
    ["candidate-management", "product-capture"].includes(targetFeature) &&
    targetFeature !== owner &&
    !/^public(?:\.js|\.ts)?$/.test(targetPath ?? "")
  );
};

/** @param {string} sourcePath @param {string} specifier */
const isForbiddenSettingsImport = (sourcePath, specifier) => {
  const normalizedSource = sourcePath.replaceAll("\\", "/");
  if (!/(?:^|\/)features\/settings\//.test(normalizedSource)) return false;
  const normalizedSpecifier = specifier.replaceAll("\\", "/");
  if (!normalizedSpecifier.startsWith(".")) return false;
  if (normalizedSpecifier.startsWith("./")) return false;
  return !/(?:^|\/)(?:application-shell|ui-language|ui-messages|features\/backup-restore|backup-restore)\/public(?:\.js|\.ts)?$/.test(
    normalizedSpecifier,
  );
};

/** @param {string} sourcePath @param {string} specifier */
const isForbiddenUiLanguageImport = (sourcePath, specifier) => {
  const normalizedSource = sourcePath.replaceAll("\\", "/");
  if (!/(?:^|\/)ui-language\//.test(normalizedSource)) return false;
  const normalizedSpecifier = specifier.replaceAll("\\", "/");
  if (!normalizedSpecifier.startsWith(".")) return false;
  if (normalizedSpecifier.startsWith("./")) return false;
  return !/(?:^|\/)(?:ui-messages|domain)\/public(?:\.js|\.ts)?$/.test(
    normalizedSpecifier,
  );
};

/** @param {string} sourcePath @param {string} specifier */
const isForbiddenUiLanguageConsumerImport = (sourcePath, specifier) => {
  const normalizedSource = sourcePath.replaceAll("\\", "/");
  if (/(?:^|\/)ui-language\//.test(normalizedSource)) return false;
  if (
    !/(?:^|\/)(?:application-shell|features\/settings|runtime)\//.test(
      normalizedSource,
    )
  )
    return false;
  const normalizedSpecifier = specifier.replaceAll("\\", "/");
  if (!/(?:^|\/)ui-language\//.test(normalizedSpecifier)) return false;
  return !/(?:^|\/)ui-language\/(?:public|runtime)(?:\.js|\.ts)?$/.test(
    normalizedSpecifier,
  );
};

/** @param {string} value */
const canonicalApiPath = (value) =>
  value.startsWith("globalThis.") ? value.slice("globalThis.".length) : value;

const candidateCatalogConsumerTypes = new Set([
  "CandidateSourceCatalogPort",
  "CandidateSourceReference",
  "ManagementError",
]);
const foundationConsumerTypes = new Set(["Result"]);

/** @param {import("typescript/unstable/ast").Node} root @param {(node: import("typescript/unstable/ast").Node) => void} visitor */
const walkAst = (root, visitor) => {
  visitor(root);
  root.forEachChild((child) => {
    walkAst(child, visitor);
  });
};

/** @param {import("typescript/unstable/ast").Node | undefined} node @returns {string | undefined} */
const staticModuleText = (node) => {
  if (node === undefined) return undefined;
  if (isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node))
    return node.text.replaceAll("\\", "/");
  if (
    isBinaryExpression(node) &&
    node.operatorToken.kind === AstSyntaxKind.PlusToken
  ) {
    /** @type {string | undefined} */
    const left = staticModuleText(node.left);
    /** @type {string | undefined} */
    const right = staticModuleText(node.right);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  return undefined;
};

/** @param {string} specifier @param {readonly string[]} names @param {boolean} namespace */
const violatesConsumerModuleAccess = (specifier, names, namespace) => {
  const candidate = specifier.match(
    /(?:^|\/)features\/candidate-management\/([^/]+)$/,
  );
  if (candidate !== null)
    return (
      !/^public\.(?:js|ts)$/.test(candidate[1] ?? "") ||
      namespace ||
      names.some((name) => !candidateCatalogConsumerTypes.has(name))
    );
  if (/(?:^|\/)persistence\//.test(specifier)) return true;
  const domain = specifier.match(/(?:^|\/)domain\/([^/]+)$/);
  if (domain !== null)
    return (
      !/^public\.(?:js|ts)$/.test(domain[1] ?? "") ||
      namespace ||
      names.some((name) => !foundationConsumerTypes.has(name))
    );
  const feature = specifier.match(/(?:^|\/)features\/[^/]+\/([^/]+)$/);
  return feature !== null && !/^public\.(?:js|ts)$/.test(feature[1] ?? "");
};

/** @param {import("typescript/unstable/ast").SourceFile} sourceFile */
const violatesSourceCatalogConsumerImports = (sourceFile) => {
  let violation = false;
  walkAst(sourceFile, (node) => {
    if (violation) return;
    if (isImportDeclaration(node)) {
      const specifier = staticModuleText(node.moduleSpecifier);
      if (specifier === undefined) return;
      const clause = node.importClause;
      const named = clause?.namedBindings;
      const namespace =
        clause?.name !== undefined ||
        (named !== undefined && !isNamedImports(named));
      const names =
        named !== undefined && isNamedImports(named)
          ? named.elements.map(
              (element) => (element.propertyName ?? element.name).text,
            )
          : [];
      violation = violatesConsumerModuleAccess(specifier, names, namespace);
      return;
    }
    if (isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
      const specifier = staticModuleText(node.moduleSpecifier);
      if (specifier === undefined) return;
      const clause = node.exportClause;
      const namespace = clause === undefined || !isNamedExports(clause);
      const names =
        clause !== undefined && isNamedExports(clause)
          ? clause.elements.map(
              (element) => (element.propertyName ?? element.name).text,
            )
          : [];
      violation = violatesConsumerModuleAccess(specifier, names, namespace);
      return;
    }
    if (
      isCallExpression(node) &&
      node.expression.kind === AstSyntaxKind.ImportKeyword
    ) {
      const specifier = staticModuleText(node.arguments[0]);
      violation =
        specifier === undefined ||
        violatesConsumerModuleAccess(specifier, [], true);
      return;
    }
    if (isImportTypeNode(node)) {
      const argument = node.argument;
      const specifier = isLiteralTypeNode(argument)
        ? staticModuleText(argument.literal)
        : undefined;
      const names = [];
      let qualifier = node.qualifier;
      while (qualifier !== undefined && !isIdentifier(qualifier))
        qualifier = qualifier.right;
      if (qualifier !== undefined) names.push(qualifier.text);
      violation =
        specifier === undefined ||
        violatesConsumerModuleAccess(specifier, names, false);
    }
  });
  return violation;
};

/** @param {import("typescript/unstable/ast").Node} node */
const unwrapExpression = (node) => {
  let current = node;
  while (
    isParenthesizedExpression(current) ||
    isAsExpression(current) ||
    isNonNullExpression(current) ||
    isSatisfiesExpression(current)
  )
    current = current.expression;
  return current;
};

/** @param {import("typescript/unstable/ast").Node} node @param {ReadonlyMap<string, string>} strings */
const propertyNameText = (node, strings = new Map()) => {
  if (isIdentifier(node) || isStringLiteral(node)) return node.text;
  if (isComputedPropertyName(node))
    return staticString(node.expression, strings);
  return undefined;
};

/** @param {import("typescript/unstable/ast").Node} node @param {ReadonlyMap<string, string>} strings @returns {string | undefined} */
const staticString = (node, strings) => {
  const expression = unwrapExpression(node);
  if (
    isStringLiteral(expression) ||
    isNoSubstitutionTemplateLiteral(expression)
  )
    return expression.text;
  if (isIdentifier(expression)) return strings.get(expression.text);
  if (
    isBinaryExpression(expression) &&
    expression.operatorToken.kind === AstSyntaxKind.PlusToken
  ) {
    /** @type {string | undefined} */
    const left = staticString(expression.left, strings);
    /** @type {string | undefined} */
    const right = staticString(expression.right, strings);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  return undefined;
};

/** @param {import("typescript/unstable/ast").SourceFile} sourceFile */
const candidateCatalogStaticStrings = (sourceFile) => {
  const strings = new Map();
  let changed = true;
  while (changed) {
    changed = false;
    walkAst(sourceFile, (node) => {
      if (
        !isVariableDeclaration(node) ||
        !isIdentifier(node.name) ||
        node.initializer === undefined ||
        (node.parent.flags & AstNodeFlags.Const) === 0
      )
        return;
      const value = staticString(node.initializer, strings);
      if (value !== undefined && strings.get(node.name.text) !== value) {
        strings.set(node.name.text, value);
        changed = true;
      }
    });
  }
  return strings;
};

/** @param {import("typescript/unstable/ast").Node} node @param {ReadonlySet<string>} reflectNamespaces @param {ReadonlySet<string>} reflectGets @param {ReadonlyMap<string, string>} strings */
const isReflectGetExpression = (
  node,
  reflectNamespaces,
  reflectGets,
  strings,
) => {
  const expression = unwrapExpression(node);
  if (isIdentifier(expression)) return reflectGets.has(expression.text);
  if (isPropertyAccessExpression(expression)) {
    const owner = unwrapExpression(expression.expression);
    return (
      isIdentifier(owner) &&
      reflectNamespaces.has(owner.text) &&
      expression.name.text === "get"
    );
  }
  if (isElementAccessExpression(expression)) {
    const owner = unwrapExpression(expression.expression);
    return (
      isIdentifier(owner) &&
      reflectNamespaces.has(owner.text) &&
      staticString(expression.argumentExpression, strings) === "get"
    );
  }
  return false;
};

/** @typedef {"known" | "ambiguous"} PageUrlTaint */

/** @param {import("typescript/unstable/ast").Node} node @param {ReadonlyMap<string, PageUrlTaint>} aliases @param {ReadonlySet<string>} reflectNamespaces @param {ReadonlySet<string>} reflectGets @param {ReadonlyMap<string, string>} strings @returns {PageUrlTaint | undefined} */
const pageUrlTaint = (
  node,
  aliases,
  reflectNamespaces,
  reflectGets,
  strings,
) => {
  const expression = unwrapExpression(node);
  if (isIdentifier(expression)) return aliases.get(expression.text);
  if (isPropertyAccessExpression(expression))
    return expression.name.text === "pageUrl" ? "known" : undefined;
  if (isElementAccessExpression(expression)) {
    const property = staticString(expression.argumentExpression, strings);
    if (property === "pageUrl") return "known";
    return property === undefined ? "ambiguous" : undefined;
  }
  if (
    isCallExpression(expression) &&
    isReflectGetExpression(
      expression.expression,
      reflectNamespaces,
      reflectGets,
      strings,
    )
  ) {
    const propertyArgument = expression.arguments[1];
    const property =
      propertyArgument === undefined
        ? undefined
        : staticString(propertyArgument, strings);
    if (property === "pageUrl") return "known";
    return property === undefined ? "ambiguous" : undefined;
  }
  return undefined;
};

/** @param {import("typescript/unstable/ast").SourceFile} sourceFile @param {ReadonlyMap<string, string>} strings */
const candidateCatalogContext = (sourceFile, strings) => {
  const declarations = new Map();
  walkAst(sourceFile, (node) => {
    if (
      isVariableDeclaration(node) &&
      isIdentifier(node.name) &&
      node.initializer !== undefined &&
      (node.parent.flags & AstNodeFlags.Const) !== 0
    )
      declarations.set(node.name.text, node.initializer);
  });
  const aliases = new Map();
  const reflectNamespaces = new Set(["Reflect"]);
  const reflectGets = new Set();
  const limit = declarations.size * 4 + 8;
  for (let iteration = 0; iteration < limit; iteration += 1) {
    let changed = false;
    for (const [name, initializer] of declarations) {
      const expression = unwrapExpression(initializer);
      if (
        isIdentifier(expression) &&
        reflectNamespaces.has(expression.text) &&
        !reflectNamespaces.has(name)
      ) {
        reflectNamespaces.add(name);
        changed = true;
      }
      if (
        isReflectGetExpression(
          expression,
          reflectNamespaces,
          reflectGets,
          strings,
        ) &&
        !reflectGets.has(name)
      ) {
        reflectGets.add(name);
        changed = true;
      }
      const taint = pageUrlTaint(
        expression,
        aliases,
        reflectNamespaces,
        reflectGets,
        strings,
      );
      if (taint !== undefined && aliases.get(name) !== taint) {
        aliases.set(name, taint);
        changed = true;
      }
    }
    walkAst(sourceFile, (node) => {
      if (!isBindingElement(node)) return;
      const bindingName = node.name;
      if (bindingName === undefined || !isIdentifier(bindingName)) return;
      const property =
        node.propertyName === undefined
          ? bindingName.text
          : propertyNameText(node.propertyName, strings);
      const taint =
        property === "pageUrl"
          ? "known"
          : node.propertyName !== undefined &&
              isComputedPropertyName(node.propertyName) &&
              property === undefined
            ? "ambiguous"
            : undefined;
      if (taint !== undefined && aliases.get(bindingName.text) !== taint) {
        aliases.set(bindingName.text, taint);
        changed = true;
      }
    });
    if (!changed) break;
  }
  return { aliases, reflectNamespaces, reflectGets };
};

const equalityKinds = new Set([
  AstSyntaxKind.EqualsEqualsToken,
  AstSyntaxKind.EqualsEqualsEqualsToken,
  AstSyntaxKind.ExclamationEqualsToken,
  AstSyntaxKind.ExclamationEqualsEqualsToken,
]);

/** @param {import("typescript/unstable/ast").Node} node */
const isNullish = (node) => {
  const expression = unwrapExpression(node);
  return (
    expression.kind === AstSyntaxKind.NullKeyword ||
    (isIdentifier(expression) && expression.text === "undefined")
  );
};

/** @param {import("typescript/unstable/ast").Node} node */
const isDeclarationOrPropertyName = (node) => {
  const parent = node.parent;
  return (
    (isVariableDeclaration(parent) && parent.name === node) ||
    (isBindingElement(parent) &&
      (parent.name === node || parent.propertyName === node)) ||
    (isPropertyAccessExpression(parent) && parent.name === node) ||
    (isPropertyAssignment(parent) && parent.name === node)
  );
};

/** @param {import("typescript/unstable/ast").SourceFile} sourceFile */
const hasCandidateCatalogUrlOwnership = (sourceFile) => {
  const strings = candidateCatalogStaticStrings(sourceFile);
  const { aliases, reflectNamespaces, reflectGets } = candidateCatalogContext(
    sourceFile,
    strings,
  );
  let violation = false;
  walkAst(sourceFile, (candidate) => {
    if (violation) return;
    const taint = pageUrlTaint(
      candidate,
      aliases,
      reflectNamespaces,
      reflectGets,
      strings,
    );
    if (taint === undefined) return;
    const node = unwrapExpression(candidate);
    if (isIdentifier(node) && isDeclarationOrPropertyName(node)) return;
    const parent = node.parent;
    if (isVariableDeclaration(parent) && parent.initializer === node) return;
    if (
      isPropertyAssignment(parent) &&
      parent.initializer === node &&
      propertyNameText(parent.name, strings) === "pageUrl" &&
      taint === "known"
    )
      return;
    if (
      isShorthandPropertyAssignment(parent) &&
      isIdentifier(node) &&
      parent.name === node &&
      node.text === "pageUrl"
    )
      return;
    if (
      isBinaryExpression(parent) &&
      equalityKinds.has(parent.operatorToken.kind)
    ) {
      const other = parent.left === node ? parent.right : parent.left;
      if (isNullish(other)) return;
    }
    violation = true;
  });
  return violation;
};

/** @param {readonly SourceFile[]} sources @returns {BoundaryViolation[]} */
export const findBoundaryViolations = (sources) => {
  const astInputs = sources.map((source, index) => ({ source, index }));
  return withTypeScriptAsts(
    astInputs.map(({ source }) => source),
    (asts) => {
      const astBySourceIndex = new Map(
        astInputs.map(({ index }, astIndex) => [index, asts[astIndex]]),
      );
      return sources.flatMap(({ path, source }, sourceIndex) => {
        const normalizedPath = path.replaceAll("\\", "/");
        const isSourceCatalogConsumer =
          /(?:^|\/)tests\/tooling\/source-price-refresh-consumer\.ts$/.test(
            normalizedPath,
          );
        const isCandidateSourceCatalog = normalizedPath.endsWith(
          "/features/candidate-management/source-catalog.ts",
        );
        const isApplicationShell =
          normalizedPath.includes("/application-shell/") ||
          normalizedPath.includes("/runtime/") ||
          /\/src\/index\.(?:ts|js)$/.test(`/${normalizedPath}`);
        const isDownstreamFeature = normalizedPath.includes("/features/");
        const ownsFoundationInternals = /(?:^|\/)src\/persistence\//.test(
          normalizedPath,
        );
        const isWebLocksAdapter =
          /(?:^|\/)src\/persistence\/web-locks-adapter\.ts$/.test(
            normalizedPath,
          );
        const tokens = tokenize(source);
        const aliases = new Map();
        const rules = new Set();
        for (let index = 0; index < tokens.length; index += 1) {
          const token = tokens[index];
          if (token === undefined) continue;
          const string = foldedString(tokens, index);
          if (string?.value === LOCK_NAME && !isWebLocksAdapter)
            rules.add("no-root-lock-bypass");
          if (
            !ownsFoundationInternals &&
            token?.kind === SyntaxKind.StringLiteral &&
            isForbiddenImport(token.value) &&
            tokens
              .slice(Math.max(0, index - 4), index)
              .some(({ kind }) =>
                [SyntaxKind.ImportKeyword, SyntaxKind.FromKeyword].includes(
                  kind,
                ),
              )
          )
            rules.add("public-import-only");
          if (
            isApplicationShell &&
            token.kind === SyntaxKind.StringLiteral &&
            isForbiddenApplicationShellFeatureImport(token.value) &&
            tokens
              .slice(Math.max(0, index - 4), index)
              .some(({ kind }) =>
                [SyntaxKind.ImportKeyword, SyntaxKind.FromKeyword].includes(
                  kind,
                ),
              )
          )
            rules.add("application-shell-feature-public-import-only");
          if (
            token.kind === SyntaxKind.StringLiteral &&
            isForbiddenCrossFeatureImport(normalizedPath, token.value) &&
            tokens
              .slice(Math.max(0, index - 4), index)
              .some(({ kind }) =>
                [SyntaxKind.ImportKeyword, SyntaxKind.FromKeyword].includes(
                  kind,
                ),
              )
          )
            rules.add("cross-feature-public-import-only");
          if (
            token.kind === SyntaxKind.StringLiteral &&
            isForbiddenSettingsImport(normalizedPath, token.value) &&
            tokens
              .slice(Math.max(0, index - 4), index)
              .some(({ kind }) =>
                [SyntaxKind.ImportKeyword, SyntaxKind.FromKeyword].includes(
                  kind,
                ),
              )
          )
            rules.add("settings-public-dependencies-only");
          if (
            token.kind === SyntaxKind.StringLiteral &&
            isForbiddenUiLanguageImport(normalizedPath, token.value) &&
            tokens
              .slice(Math.max(0, index - 4), index)
              .some(({ kind }) =>
                [SyntaxKind.ImportKeyword, SyntaxKind.FromKeyword].includes(
                  kind,
                ),
              )
          )
            rules.add("ui-language-public-dependencies-only");
          if (
            token.kind === SyntaxKind.StringLiteral &&
            isForbiddenUiLanguageConsumerImport(normalizedPath, token.value) &&
            tokens
              .slice(Math.max(0, index - 4), index)
              .some(({ kind }) =>
                [SyntaxKind.ImportKeyword, SyntaxKind.FromKeyword].includes(
                  kind,
                ),
              )
          )
            rules.add("ui-language-consumer-public-entry-only");
          const pathValue = memberPath(tokens, index, aliases);
          if (
            !isWebLocksAdapter &&
            pathValue !== undefined &&
            canonicalApiPath(pathValue.value).startsWith("navigator.locks")
          )
            rules.add(
              isApplicationShell
                ? "application-shell-no-direct-locks"
                : "no-root-lock-bypass",
            );
          if (
            token?.kind === SyntaxKind.Identifier &&
            tokens[index + 1]?.kind === SyntaxKind.EqualsToken
          ) {
            const assigned = memberPath(tokens, index + 2, aliases);
            if (assigned !== undefined)
              aliases.set(token.value, canonicalApiPath(assigned.value));
          }
          if (token.kind === SyntaxKind.OpenBraceToken) {
            const bindings = [];
            let cursor = index + 1;
            while (
              tokens[cursor]?.kind === SyntaxKind.Identifier &&
              cursor < tokens.length
            ) {
              const property = tokens[cursor]?.value;
              let local = property;
              cursor += 1;
              if (tokens[cursor]?.kind === SyntaxKind.ColonToken) {
                cursor += 1;
                if (tokens[cursor]?.kind !== SyntaxKind.Identifier) break;
                local = tokens[cursor]?.value;
                cursor += 1;
              }
              if (property !== undefined && local !== undefined)
                bindings.push({ property, local });
              if (tokens[cursor]?.kind !== SyntaxKind.CommaToken) break;
              cursor += 1;
            }
            if (
              tokens[cursor]?.kind === SyntaxKind.CloseBraceToken &&
              tokens[cursor + 1]?.kind === SyntaxKind.EqualsToken
            ) {
              const assigned = memberPath(tokens, cursor + 2, aliases);
              if (assigned !== undefined)
                for (const binding of bindings)
                  aliases.set(
                    binding.local,
                    `${canonicalApiPath(assigned.value)}.${binding.property}`,
                  );
            }
          }
        }
        const ast = astBySourceIndex.get(sourceIndex);
        if (
          isSourceCatalogConsumer &&
          ast !== undefined &&
          violatesSourceCatalogConsumerImports(ast)
        )
          rules.add("source-catalog-consumer-public-contract-only");
        if (
          isCandidateSourceCatalog &&
          ast !== undefined &&
          hasCandidateCatalogUrlOwnership(ast)
        )
          rules.add("candidate-source-catalog-no-url-matching");
        if (
          isApplicationShell &&
          /\b(?:interface|type|class)\s+MaintenanceSnapshotSource\b/.test(
            source,
          )
        )
          rules.add("application-shell-no-maintenance-contract-redefinition");
        if (normalizedPath.includes("/features/product-capture/")) {
          if (
            /\b(?:interface|type|class)\s+CandidateManagementPublicApi\b/.test(
              source,
            )
          )
            rules.add("product-capture-no-public-api-redefinition");
          if (/\bCaptureCandidatePort\b/.test(source))
            rules.add("product-capture-no-legacy-candidate-port");
          if (/\bopenCandidateEditor\b/.test(source))
            rules.add("product-capture-no-legacy-editor-navigation");
          if (
            /presentation\s*:\s*["']transient["']/.test(source) &&
            /\bnavigation\s*:/.test(source)
          )
            rules.add("product-capture-transient-no-navigation");
          if (/nav\.productCapture/.test(source))
            rules.add("product-capture-no-navigation-message");
        }
        if (isApplicationShell && /\bFoundationRuntimePlatform\b/.test(source))
          rules.add("application-shell-no-foundation-platform-injection");
        if (
          isApplicationShell &&
          /\binitializeFoundationRuntimeContribution\b(?!FromPlatform)/.test(
            source,
          )
        )
          rules.add("application-shell-no-foundation-di-initializer");
        if (
          isApplicationShell &&
          /\b(?:createWriteAuthority|WriteAuthority)\b/.test(source)
        )
          rules.add("application-shell-no-foundation-authority");
        if (
          /(?:^|\/)src\//.test(normalizedPath) &&
          /\bdangerouslySetInnerHTML\b|(?:\.|\[\s*["']innerHTML["']\s*\])\s*=/.test(
            source,
          )
        )
          rules.add("no-dangerous-html-rendering");
        if (
          /\bgetSnapshot\s*:\s*(?:async\s*)?\(?.*?=>[\s\S]*?status\s*:\s*["']inactive["'][\s\S]*?\bsubscribe\s*:\s*\(?.*?=>\s*\(?.*?=>\s*\{\s*\}/.test(
            source,
          )
        )
          rules.add("no-dummy-maintenance-source");
        if (
          /\b(?:onStateChange|observeShellState|subscribeShellState)\s*:\s*\(?.*?=>\s*\{\s*\}/.test(
            source,
          )
        )
          rules.add("no-noop-shell-state-observer");
        if (
          isDownstreamFeature &&
          /["'][^"']*(?:application-shell\/(?:feature-contribution-catalog|application-composition|runtime-bootstrap)|src\/index)[^"']*["']/.test(
            source.replaceAll("\\", "/"),
          )
        )
          rules.add("no-shared-entry-self-registration");
        if (
          /@babel\/standalone|\bBabel\s*\.\s*transform\s*\(|\bjsxDEV\s*\(/.test(
            source,
          )
        )
          rules.add("no-runtime-jsx-transform");
        return [...rules].map((rule) => ({ path, rule }));
      });
    },
  );
};

// StorageAccessGuard (3.2, 3.4): `chrome.storage.local` reachability is confined
// to the local-data foundation adapter and display-language preference port.
// The transient surface separately owns one `chrome.storage.session` adapter.
// No other source file may reach either storage area. Bundled `dist/` output
// merges those adapters into the three listed entry bundles.
const STORAGE_ACCESS_SOURCE_POLICIES = [
  {
    pattern: /(?:^|\/)persistence\/chrome-storage-adapter\.ts$/,
    area: "local",
  },
  {
    pattern: /(?:^|\/)ui-language\/preference-store\.ts$/,
    area: "local",
  },
  {
    pattern: /(?:^|\/)runtime\/transient-activation-store\.ts$/,
    area: "session",
  },
];
const ALLOWED_STORAGE_ACCESS_BUNDLE_PATHS = new Set([
  "dist/foundation.js",
  "dist/side-panel.js",
  "dist/service-worker.js",
]);

/** @param {string} path */
const storageAccessPolicyFor = (path) => {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\/+/, "");
  const sourcePolicy = STORAGE_ACCESS_SOURCE_POLICIES.find(({ pattern }) =>
    pattern.test(normalized),
  );
  if (sourcePolicy !== undefined)
    return { kind: "source", area: sourcePolicy.area };
  // Bundles merge several source adapters, so area mixing is expected only at
  // these exact build-output paths. A matching basename elsewhere is not a
  // trusted artifact and must not inherit the exemption.
  if (ALLOWED_STORAGE_ACCESS_BUNDLE_PATHS.has(normalized))
    return { kind: "bundle" };
  return { kind: "forbidden" };
};

/** @param {readonly SourceFile[]} sources @returns {BoundaryViolation[]} */
export const findStorageAccessViolations = (sources) =>
  sources.flatMap(({ path, source }) => {
    const policy = storageAccessPolicyFor(path);
    const tokens = tokenize(source);
    const aliases = new Map();
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token === undefined) continue;
      const pathValue = memberPath(tokens, index, aliases);
      if (pathValue !== undefined) {
        const apiPath = canonicalApiPath(pathValue.value);
        if (apiPath.startsWith("chrome.storage")) {
          if (policy.kind === "bundle") continue;
          const area = apiPath.split(".")[2];
          if (
            policy.kind === "forbidden" ||
            (policy.kind === "source" &&
              (area === undefined || area !== policy.area))
          )
            return [{ path, rule: "no-direct-storage-access" }];
        }
      }
      if (
        token.kind === SyntaxKind.Identifier &&
        tokens[index + 1]?.kind === SyntaxKind.EqualsToken
      ) {
        const assigned = memberPath(tokens, index + 2, aliases);
        if (assigned !== undefined)
          aliases.set(token.value, canonicalApiPath(assigned.value));
      }
    }
    return [];
  });

/** @param {string} root @returns {Promise<SourceFile[]>} */
const collectSources = async (root) => {
  const entry = await stat(root).catch(() => undefined);
  if (entry === undefined)
    throw new Error(`boundary scan root does not exist: ${root}`);
  if (entry.isFile())
    return /\.(?:ts|tsx|js|mjs)$/.test(root)
      ? [{ path: root, source: await readFile(root, "utf8") }]
      : [];
  const sources = [];
  for (const child of await readdir(root, { withFileTypes: true })) {
    const childPath = `${root}/${child.name}`;
    if (child.isDirectory()) sources.push(...(await collectSources(childPath)));
    else if (/\.(?:ts|tsx|js|mjs)$/.test(child.name))
      sources.push({
        path: childPath,
        source: await readFile(childPath, "utf8"),
      });
  }
  return sources;
};

/** @param {readonly string[]} roots */
export const validateBoundaryRoots = async (roots) => {
  const sources = (await Promise.all(roots.map(collectSources))).flat();
  return [
    ...findBoundaryViolations(sources),
    ...findStorageAccessViolations(sources),
  ];
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const roots = process.argv.slice(2);
  if (roots.length === 0)
    throw new Error("at least one boundary scan root is required");
  const violations = await validateBoundaryRoots(roots);
  if (violations.length > 0) {
    for (const violation of violations)
      console.error(`${violation.path}: ${violation.rule}`);
    process.exitCode = 1;
  }
}
