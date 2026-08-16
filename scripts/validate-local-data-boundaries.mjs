import { readdir, readFile, stat } from "node:fs/promises";
import { posix } from "node:path";
import { pathToFileURL } from "node:url";
import {
  SyntaxKind as AstSyntaxKind,
  NodeFlags,
} from "typescript/unstable/ast";
import {
  isAssertionExpression,
  isClassDeclaration,
  isComputedPropertyName,
  isConstructorDeclaration,
  isFunctionDeclaration,
  isGetAccessorDeclaration,
  isIdentifier,
  isInterfaceDeclaration,
  isParenthesizedExpression,
  isParenthesizedTypeNode,
  isPropertyAssignment,
  isPropertyDeclaration,
  isPropertySignatureDeclaration,
  isSetAccessorDeclaration,
  isStringLiteral,
  isTypeAliasDeclaration,
  isTypeLiteralNode,
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

/** @param {import("typescript/unstable/ast").Node} root @param {(node: import("typescript/unstable/ast").Node) => void} visitor */
const walkAst = (root, visitor) => {
  visitor(root);
  root.forEachChild((child) => walkAst(child, visitor));
};

/** @param {import("typescript/unstable/ast").SourceFile} sourceFile */
const ownershipShapes = (sourceFile) => {
  /**
   * @typedef {{
   *   readonly declaration: import("typescript/unstable/ast").Node,
   *   readonly kind: "alias-target" | "stop",
   *   readonly target: import("typescript/unstable/ast").Node | undefined,
   * }} LocalBinding
   */
  /** @type {Map<import("typescript/unstable/ast").Node, Map<string, LocalBinding[]>>} */
  const typeBindings = new Map();
  /** @type {Map<import("typescript/unstable/ast").Node, Map<string, LocalBinding[]>>} */
  const valueBindings = new Map();
  /** @param {import("typescript/unstable/ast").Node} node */
  const isLexicalScope = (node) =>
    [
      AstSyntaxKind.SourceFile,
      AstSyntaxKind.Block,
      AstSyntaxKind.ModuleBlock,
      AstSyntaxKind.FunctionDeclaration,
      AstSyntaxKind.FunctionExpression,
      AstSyntaxKind.ArrowFunction,
      AstSyntaxKind.MethodDeclaration,
      AstSyntaxKind.Constructor,
      AstSyntaxKind.GetAccessor,
      AstSyntaxKind.SetAccessor,
      AstSyntaxKind.InterfaceDeclaration,
      AstSyntaxKind.TypeAliasDeclaration,
      AstSyntaxKind.ClassDeclaration,
    ].includes(node.kind);
  /** @param {import("typescript/unstable/ast").Node} node */
  const containingScope = (node) => {
    let current = node.parent;
    while (current !== undefined && !isLexicalScope(current))
      current = current.parent;
    return current ?? sourceFile;
  };
  /**
   * @param {Map<import("typescript/unstable/ast").Node, Map<string, LocalBinding[]>>} index
   * @param {string} name
   * @param {import("typescript/unstable/ast").Node} declaration
   * @param {LocalBinding["kind"]} kind
   * @param {import("typescript/unstable/ast").Node | undefined} target
   * @param {import("typescript/unstable/ast").Node} [scope]
   */
  const registerBinding = (
    index,
    name,
    declaration,
    kind,
    target,
    scope = containingScope(declaration),
  ) => {
    let bindings = index.get(scope);
    if (bindings === undefined) {
      bindings = new Map();
      index.set(scope, bindings);
    }
    const namedBindings = bindings.get(name) ?? [];
    namedBindings.push({ declaration, kind, target });
    bindings.set(name, namedBindings);
  };
  walkAst(sourceFile, (node) => {
    if (isTypeAliasDeclaration(node) && isIdentifier(node.name))
      registerBinding(
        typeBindings,
        node.name.text,
        node,
        "alias-target",
        node.type,
      );
    if (isLexicalScope(node) && "typeParameters" in node)
      for (const parameter of /** @type {{ typeParameters?: readonly import("typescript/unstable/ast").TypeParameterDeclaration[] }} */ (
        node
      ).typeParameters ?? [])
        if (isIdentifier(parameter.name))
          registerBinding(
            typeBindings,
            parameter.name.text,
            parameter,
            "stop",
            undefined,
            node,
          );
    if (
      isVariableDeclaration(node) &&
      isIdentifier(node.name) &&
      node.initializer !== undefined &&
      (node.parent.flags & NodeFlags.Const) !== 0
    )
      registerBinding(
        valueBindings,
        node.name.text,
        node,
        "alias-target",
        node.initializer,
      );
  });
  /**
   * @param {Map<import("typescript/unstable/ast").Node, Map<string, LocalBinding[]>>} index
   * @param {string} name
   * @param {import("typescript/unstable/ast").Node} context
   */
  const findBinding = (index, name, context) => {
    let scope = isLexicalScope(context) ? context : containingScope(context);
    while (scope !== undefined) {
      const candidates = index.get(scope)?.get(name);
      if (candidates !== undefined) {
        const beforeReference = candidates.filter(
          ({ declaration }) => declaration.pos <= context.pos,
        );
        return beforeReference.at(-1) ?? candidates[0];
      }
      if (scope === sourceFile) break;
      scope = containingScope(scope);
    }
    return undefined;
  };
  /** @param {import("typescript/unstable/ast").Node | undefined} type @param {import("typescript/unstable/ast").Node} context @param {Set<import("typescript/unstable/ast").Node>} [seen] */
  const resolvedTypeText = (type, context, seen = new Set()) => {
    if (type === undefined) return "";
    let current = type;
    while (isParenthesizedTypeNode(current)) current = current.type;
    const text = current.getText(sourceFile);
    if (!/^[A-Za-z_$][\w$]*$/.test(text)) return text;
    const binding = findBinding(typeBindings, text, context);
    if (binding === undefined || seen.has(binding.declaration)) return text;
    if (binding.kind === "stop") return text;
    seen.add(binding.declaration);
    return resolvedTypeText(binding.target, binding.declaration, seen);
  };
  /** @param {import("typescript/unstable/ast").Node | undefined} name */
  const staticPropertyName = (name) => {
    if (name === undefined) return undefined;
    if (isIdentifier(name) || isStringLiteral(name)) return name.text;
    if (!isComputedPropertyName(name)) return undefined;
    /** @param {import("typescript/unstable/ast").Node} expression @param {import("typescript/unstable/ast").Node} context @param {Set<import("typescript/unstable/ast").Node>} seen */
    const resolveLocalConstString = (expression, context, seen) => {
      let current = expression;
      while (
        isAssertionExpression(current) ||
        isParenthesizedExpression(current)
      )
        current = current.expression;
      if (isStringLiteral(current)) return current.text;
      if (!isIdentifier(current)) return undefined;
      const binding = findBinding(valueBindings, current.text, context);
      if (
        binding === undefined ||
        binding.target === undefined ||
        seen.has(binding.declaration)
      )
        return undefined;
      seen.add(binding.declaration);
      return resolveLocalConstString(binding.target, binding.declaration, seen);
    };
    return resolveLocalConstString(name.expression, name.expression, new Set());
  };
  /** @param {import("typescript/unstable/ast").Node} node */
  const assertionChain = (node) => {
    const types = [];
    let current = node;
    while (true) {
      if (isParenthesizedExpression(current)) {
        current = current.expression;
        continue;
      }
      if (!isAssertionExpression(current)) break;
      types.push(resolvedTypeText(current.type, current.type));
      current = current.expression;
    }
    return types;
  };
  /** @param {import("typescript/unstable/ast").Node} node @param {number} kind */
  const hasModifier = (node, kind) =>
    /** @type {{ modifiers?: readonly { kind: number }[] }} */ (
      node
    ).modifiers?.some((modifier) => modifier.kind === kind) ?? false;
  /** @param {import("typescript/unstable/ast").Node} member */
  const directMemberField = (member) => {
    if (
      (isPropertyDeclaration(member) ||
        isGetAccessorDeclaration(member) ||
        isSetAccessorDeclaration(member)) &&
      hasModifier(member, AstSyntaxKind.StaticKeyword)
    )
      return undefined;
    if (
      isPropertySignatureDeclaration(member) ||
      isPropertyDeclaration(member) ||
      isGetAccessorDeclaration(member)
    )
      return { name: staticPropertyName(member.name), type: member.type };
    if (isSetAccessorDeclaration(member))
      return {
        name: staticPropertyName(member.name),
        type: member.parameters[0]?.type,
      };
    return undefined;
  };
  /** @param {import("typescript/unstable/ast").Node} declaration */
  const directFields = (declaration) => {
    let members;
    if (isInterfaceDeclaration(declaration) || isClassDeclaration(declaration))
      members = declaration.members;
    else if (isTypeAliasDeclaration(declaration)) {
      let type = declaration.type;
      while (isParenthesizedTypeNode(type)) type = type.type;
      members = isTypeLiteralNode(type) ? type.members : [];
    } else members = [];
    const fields = [...members].flatMap((member) => {
      const field = directMemberField(member);
      if (field !== undefined) return [field];
      if (!isClassDeclaration(declaration) || !isConstructorDeclaration(member))
        return [];
      return member.parameters
        .filter((parameter) =>
          [
            AstSyntaxKind.PublicKeyword,
            AstSyntaxKind.PrivateKeyword,
            AstSyntaxKind.ProtectedKeyword,
            AstSyntaxKind.ReadonlyKeyword,
          ].some((kind) => hasModifier(parameter, kind)),
        )
        .map((parameter) => ({
          name: staticPropertyName(parameter.name),
          type: parameter.type,
        }));
    });
    return fields;
  };
  let productRecoveryControl = false;
  let numericRecoveryLease = false;
  let unsafeRecoveryProtocolCast = false;
  let recoveryPendingMarker = false;
  walkAst(sourceFile, (node) => {
    const declarationName =
      isInterfaceDeclaration(node) ||
      isTypeAliasDeclaration(node) ||
      isClassDeclaration(node)
        ? node.name
        : undefined;
    if (declarationName !== undefined && isIdentifier(declarationName)) {
      const fields = directFields(node);
      numericRecoveryLease ||=
        !/^Synthetic/i.test(declarationName.text) &&
        /Recovery|Persistent/i.test(declarationName.text) &&
        fields.some(
          (field) =>
            /lease/i.test(field.name ?? "") &&
            resolvedTypeText(field.type, field.type ?? node) === "number",
        );
      // Product control ownership is semantic: a product-prefixed recovery
      // control declaration plus an owner/lifecycle field, independent of the
      // exact declaration suffix. Synthetic control declarations remain valid.
      if (
        /^Product/i.test(declarationName.text) &&
        /Recovery/i.test(declarationName.text) &&
        /Control/i.test(declarationName.text) &&
        fields.some((field) =>
          /owner|phase|state|pending|lease/i.test(field.name ?? ""),
        )
      )
        productRecoveryControl = true;
    }
    if (isAssertionExpression(node)) {
      const types = assertionChain(node);
      if (
        types.some((type) => /^(?:any|unknown)$/.test(type)) &&
        types.some((type) =>
          /(?:Recovery.*(?:Protocol|Control)|Protocol\s*<)/.test(type),
        )
      )
        unsafeRecoveryProtocolCast = true;
    }
    if (
      (isVariableDeclaration(node) ||
        isPropertySignatureDeclaration(node) ||
        isPropertyDeclaration(node) ||
        isPropertyAssignment(node)) &&
      /(?:recovery.*pending.*marker|pending.*(?:commit|recovery).*marker)/i.test(
        staticPropertyName(node.name) ?? "",
      )
    )
      recoveryPendingMarker = true;
  });
  return {
    productRecoveryControl,
    numericRecoveryLease,
    unsafeRecoveryProtocolCast,
    recoveryPendingMarker,
  };
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
    [...names].some(
      (name) =>
        /^Product\w*Adapter$/.test(name) &&
        !["ProductLocalDataAdapter", "ProductBackupAdapter"].includes(name),
    )
  )
    rules.push("local-data-no-product-adapter-ownership");
  const shapes = ownershipShapes(sourceFile);
  if (shapes.productRecoveryControl)
    rules.push("local-data-no-product-recovery-control-ownership");
  if (shapes.numericRecoveryLease)
    rules.push("local-data-no-numeric-recovery-lease-ownership");
  if (shapes.unsafeRecoveryProtocolCast)
    rules.push("local-data-no-unsafe-recovery-protocol-cast");
  if (shapes.recoveryPendingMarker)
    rules.push("local-data-no-recovery-pending-marker-ownership");
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
