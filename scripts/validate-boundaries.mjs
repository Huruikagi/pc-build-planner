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
  isInterfaceDeclaration,
  isLiteralTypeNode,
  isNamedExports,
  isNamedImports,
  isNonNullExpression,
  isNoSubstitutionTemplateLiteral,
  isObjectBindingPattern,
  isObjectLiteralExpression,
  isParenthesizedExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isPropertySignatureDeclaration,
  isSatisfiesExpression,
  isShorthandPropertyAssignment,
  isStringLiteral,
  isTypeAliasDeclaration,
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
  let position = 0;
  for (
    let kind = scanner.scan();
    kind !== SyntaxKind.EndOfFile;
    kind = scanner.scan()
  ) {
    const end = scanner.getTokenEnd();
    // A flat token stream has no parser to re-scan an ambiguous character, so
    // one (a `#` outside a class body, for instance) scans as a zero-width
    // token forever. Step over it instead: dropping one character keeps the
    // rest of the file reachable for every rule, where stopping would not.
    if (end <= position) {
      position += 1;
      scanner.resetTokenState(position);
      continue;
    }
    position = end;
    tokens.push({
      kind,
      text: scanner.getTokenText(),
      value: scanner.getTokenValue(),
    });
  }
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

// The shared validation kernel is a second allowed domain entry: owners declare
// their schemas through it, and its internals stay unreachable.
const ALLOWED_DOMAIN_ENTRY =
  /^(?:public|runtime-schema\/public)(?:\.js|\.ts)?$/;

/** @param {string} specifier */
const isForbiddenImport = (specifier) => {
  const normalized = specifier.replaceAll("\\", "/");
  const match = normalized.match(/\/(domain|persistence|runtime)\/(.+)$/);
  if (match === null) return false;
  if (match[1] === "runtime") return true;
  const entry = match[2] ?? "";
  return match[1] === "domain"
    ? !ALLOWED_DOMAIN_ENTRY.test(entry)
    : !/^public(?:\.js|\.ts)?$/.test(entry);
};

// Zod must be reached only through the module that configures `jitless` before
// any schema exists; a second package import would make that ordering
// unprovable and could ship an eval-capable code path into the extension.
const CANONICAL_VENDOR_SCHEMA_MODULE =
  /(?:^|\/)src\/domain\/runtime-schema\/zod-mini\.ts$/;

/** @param {string} sourcePath @param {string} specifier */
const isForbiddenVendorSchemaImport = (sourcePath, specifier) =>
  /^zod(?:\/.*)?$/.test(specifier.replaceAll("\\", "/")) &&
  !CANONICAL_VENDOR_SCHEMA_MODULE.test(sourcePath.replaceAll("\\", "/"));

/** @param {string} specifier */
const isForbiddenApplicationShellFeatureImport = (specifier) => {
  const normalized = specifier.replaceAll("\\", "/");
  const match = normalized.match(/(?:^|\/)features\/[^/]+\/(.+)$/);
  if (match === null) return false;
  return !/^(?:public|worker-public|feature-contribution)(?:\.js|\.ts)?$/.test(
    match[1] ?? "",
  );
};

/** @param {string} sourcePath @param {string} specifier */
const isForbiddenSourcePriceRefreshShellImport = (sourcePath, specifier) => {
  const normalizedSource = sourcePath.replaceAll("\\", "/");
  if (!/(?:^|\/)features\/source-price-refresh\//.test(normalizedSource))
    return false;
  const normalizedSpecifier = specifier.replaceAll("\\", "/");
  const match = normalizedSpecifier.match(/(?:^|\/)application-shell\/(.+)$/);
  if (match === null) return false;
  return !/^(?:public|worker-public)(?:\.js|\.ts)?$/.test(match[1] ?? "");
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
  // ui-language has a stricter source-aware seam policy below.
  if (/(?:^|\/)ui-language\//.test(normalizedSpecifier)) return false;
  return !/(?:^|\/)(?:application-shell|ui-language|ui-messages|features\/backup-restore|backup-restore)\/public(?:\.js|\.ts)?$/.test(
    normalizedSpecifier,
  );
};

/** @param {string} sourcePath @param {string} specifier */
const isForbiddenUiLanguageImport = (sourcePath, specifier) => {
  const normalizedSource = sourcePath.replaceAll("\\", "/");
  if (!/(?:^|\/)src\/ui-language\//.test(normalizedSource)) return false;
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
  if (/(?:^|\/)src\/ui-language\//.test(normalizedSource)) return false;
  const isRuntime = /(?:^|\/)src\/runtime\//.test(normalizedSource);
  const isPublicConsumer =
    isRuntime ||
    /(?:^|\/)src\/(?:application-shell|features\/[^/]+)\//.test(
      normalizedSource,
    );
  if (!isPublicConsumer) return false;
  const normalizedSpecifier = specifier.replaceAll("\\", "/");
  if (!/(?:^|\/)ui-language\//.test(normalizedSpecifier)) return false;
  const allowedEntry = isRuntime ? /^(?:public|runtime)$/ : /^public$/;
  const entry = normalizedSpecifier.match(
    /(?:^|\/)ui-language\/([^/]+?)(?:\.js|\.ts)?$/,
  )?.[1];
  return entry === undefined || !allowedEntry.test(entry);
};

/** @param {string} sourcePath @param {string} specifier */
const isForbiddenProjectContextConsumerImport = (sourcePath, specifier) => {
  const normalizedSource = sourcePath.replaceAll("\\", "/");
  if (/(?:^|\/)src\/project-context\//.test(normalizedSource)) return false;
  const normalizedSpecifier = specifier.replaceAll("\\", "/");
  const entry = normalizedSpecifier.match(
    /(?:^|\/)project-context\/([^/]+?)(?:\.js|\.ts)?$/,
  )?.[1];
  if (entry === undefined) return false;
  if (/(?:^|\/)src\/application-shell\//.test(normalizedSource))
    return !/^(?:public|presentation-contribution|runtime)$/.test(entry);
  if (/(?:^|\/)src\/runtime\//.test(normalizedSource))
    return entry !== "runtime";
  return entry !== "public";
};

// ProjectContextBoundaryGate (8.1, 8.4): preference adapter は storage API を
// injection で受け取るため、key scope は expression chain ではなく file scope で
// 検査する。`get` / `set` / `remove` の key argument が静的な文字列 literal として
// 専用 key へ解決できる場合だけ通し、dynamic key、const 間接、template literal、
// computed property、spread、別 key、別 key との混在をすべて拒否する。
// adapter 自身の doc comment が宣言するとおり alias も間接も持ち込まないため、
// `get` / `set` / `remove` を別名へ束縛する記述自体も違反として扱う（alias を
// 解決するのではなく禁止する）。統合規則として、storage method 名へ解決する
// member access は「CallExpression の直接 callee であるとき」だけ許し、それ以外の
// 位置（`.call` / `.apply` の receiver、代入右辺、object literal の property 値、
// return 値、call 引数、closure）に現れた時点で違反とする。これにより key 検査を
// 受けない method 参照が file の外へ逃げる経路をまとめて閉じる。
// `clear` / `getKeys` / `getBytesInUse` は area 全体
// を対象にし単一 key へ絞れないため、引数によらず無条件に拒否する（要件 8.1）。
const PROJECT_CONTEXT_PREFERENCE_KEY = "projectContextPreference";
const PROJECT_CONTEXT_STORAGE_ADAPTER =
  /(?:^|\/)src\/project-context\/preference-store\.ts$/;
const STORAGE_KEY_METHODS = new Set(["get", "set", "remove"]);
const STORAGE_AREA_METHODS = new Set(["clear", "getKeys", "getBytesInUse"]);
const METHOD_INDIRECTION_NAMES = new Set(["bind", "call", "apply"]);

/** @param {string | undefined} name */
const isStorageMethodName = (name) =>
  name !== undefined &&
  (STORAGE_KEY_METHODS.has(name) || STORAGE_AREA_METHODS.has(name));

/** @param {import("typescript/unstable/ast").Node} node @returns {string | undefined} */
const storageMemberName = (node) => {
  const expression = unwrapExpression(node);
  if (isPropertyAccessExpression(expression)) return expression.name.text;
  if (isElementAccessExpression(expression))
    return staticString(expression.argumentExpression, new Map());
  return undefined;
};

/**
 * 呼び出さずに storage method を取り出す参照か。`storage.get`、`storage["get"]`、
 * `storage.get.bind(storage)` のいずれも key 検査を迂回させる alias 元になる。
 * @param {import("typescript/unstable/ast").Node} node
 * @returns {boolean}
 */
const referencesStorageMethod = (node) => {
  const expression = unwrapExpression(node);
  if (isCallExpression(expression)) {
    const callee = unwrapExpression(expression.expression);
    if (
      !isPropertyAccessExpression(callee) &&
      !isElementAccessExpression(callee)
    )
      return false;
    const indirection = storageMemberName(callee);
    return (
      indirection !== undefined &&
      METHOD_INDIRECTION_NAMES.has(indirection) &&
      referencesStorageMethod(callee.expression)
    );
  }
  return isStorageMethodName(storageMemberName(expression));
};

/** @param {import("typescript/unstable/ast").ObjectBindingPattern} pattern */
const bindsStorageMethod = (pattern) =>
  pattern.elements.some((element) => {
    const bindingName = element.name;
    const bound =
      element.propertyName === undefined
        ? bindingName !== undefined && isIdentifier(bindingName)
          ? bindingName.text
          : undefined
        : propertyNameText(element.propertyName);
    return isStorageMethodName(bound);
  });

/** @param {import("typescript/unstable/ast").Node} node */
const dedicatedPreferenceKeyLiteral = (node) => {
  const expression = unwrapExpression(node);
  return (
    isStringLiteral(expression) &&
    expression.text === PROJECT_CONTEXT_PREFERENCE_KEY
  );
};

/** @param {import("typescript/unstable/ast").ObjectLiteralExpression} payload */
const writesOnlyDedicatedPreferenceKey = (payload) =>
  payload.properties.length > 0 &&
  payload.properties.every((property) => {
    if (
      isPropertyAssignment(property) ||
      isShorthandPropertyAssignment(property)
    )
      return (
        (isIdentifier(property.name) || isStringLiteral(property.name)) &&
        property.name.text === PROJECT_CONTEXT_PREFERENCE_KEY
      );
    return false;
  });

/**
 * 呼び出し式の直接 callee 位置にある member access か。`storage.get("...")` は真、
 * `storage.get.call(...)` の `storage.get` や `then(storage.get)` は偽になる。
 * @param {import("typescript/unstable/ast").Node} node
 * @param {import("typescript/unstable/ast").Node | undefined} parent
 */
const isDirectCallee = (node, parent) =>
  parent !== undefined &&
  isCallExpression(parent) &&
  unwrapExpression(parent.expression) === node;

/**
 * 単一 node が key scope を破っているか。true の時点で file 全体を違反とする。
 * @param {import("typescript/unstable/ast").Node} node
 * @param {import("typescript/unstable/ast").Node | undefined} parent
 */
const breaksProjectContextPreferenceKeyScope = (node, parent) => {
  // alias 束縛（分割代入・変数代入・bind）は identifier 呼び出しへ化けて
  // key 検査を素通りするため、束縛そのものを違反とする。
  if (isObjectBindingPattern(node)) return bindsStorageMethod(node);
  if (isVariableDeclaration(node))
    return (
      node.initializer !== undefined &&
      referencesStorageMethod(node.initializer)
    );
  // 統合規則: storage method へ解決する member access は直接 callee 位置以外を禁じる。
  if (isPropertyAccessExpression(node) || isElementAccessExpression(node))
    return (
      isStorageMethodName(storageMemberName(node)) &&
      !isDirectCallee(node, parent)
    );
  if (!isCallExpression(node)) return false;
  const callee = unwrapExpression(node.expression);
  /** @type {string | undefined} */
  let method;
  if (isPropertyAccessExpression(callee)) method = callee.name.text;
  else if (isElementAccessExpression(callee)) {
    // 動的に解決される method 名は key 検査自体を迂回させるため受け付けない。
    method = staticString(callee.argumentExpression, new Map());
    if (method === undefined) return true;
  }
  if (method === undefined) return false;
  // area 全体 method は key へ絞れないため引数を見るまでもなく拒否する。
  if (STORAGE_AREA_METHODS.has(method)) return true;
  if (!STORAGE_KEY_METHODS.has(method)) return false;
  const argument = node.arguments[0];
  if (argument === undefined) return true;
  if (method === "set") {
    const payload = unwrapExpression(argument);
    return (
      !isObjectLiteralExpression(payload) ||
      !writesOnlyDedicatedPreferenceKey(payload)
    );
  }
  return !dedicatedPreferenceKeyLiteral(argument);
};

/** @param {import("typescript/unstable/ast").SourceFile} sourceFile */
const violatesProjectContextPreferenceKey = (sourceFile) => {
  // 直接 callee 判定に親 node が要るため、walkAst ではなく親付きで走査する。
  /**
   * @param {import("typescript/unstable/ast").Node} node
   * @param {import("typescript/unstable/ast").Node | undefined} parent
   * @returns {boolean}
   */
  const visit = (node, parent) => {
    if (breaksProjectContextPreferenceKeyScope(node, parent)) return true;
    let violation = false;
    node.forEachChild((child) => {
      violation = violation || visit(child, node);
    });
    return violation;
  };
  return visit(sourceFile, undefined);
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

// ProjectContextBoundaryGate (8.6): legacy feature snapshot の `selectedProjectId`
// が context authority へ逆流する経路を静的に閉じる。逆流は二つの形でしか起きない。
// (1) project-context が Allowed Dependencies の外（features / application-shell /
// runtime / persistence など）を import して feature snapshot 型へ到達する。
// (2) 初期化・fallback の入力契約（Dependencies / Source / Port / Options / Input）
// 自身が選択 hint を受け取る。どちらも fail closed で拒否する。
const PROJECT_CONTEXT_SOURCE = /(?:^|\/)src\/project-context\//;
const PROJECT_CONTEXT_ALLOWED_MODULES = new Set([
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "../domain/public.js",
  "../domain/runtime-schema/public.js",
  "../ui-language/public.js",
  "../ui-messages/public.js",
]);
const LEGACY_SELECTION_FIELD = "selectedProjectId";
const PROJECT_CONTEXT_INPUT_SHAPE =
  /(?:Dependencies|Source|Port|Options|Input)$/;

/** @param {string} specifier */
const isForbiddenProjectContextDependency = (specifier) => {
  const normalized = specifier.replaceAll("\\", "/");
  // owner-local module だけは相対 sibling import を許す。
  if (/^\.\/[^/]+$/.test(normalized)) return false;
  return !PROJECT_CONTEXT_ALLOWED_MODULES.has(normalized);
};

/**
 * @param {import("typescript/unstable/ast").InterfaceDeclaration
 *   | import("typescript/unstable/ast").TypeAliasDeclaration} declaration
 */
const declaresLegacySelectionInput = (declaration) => {
  const name = declaration.name;
  if (!isIdentifier(name) || !PROJECT_CONTEXT_INPUT_SHAPE.test(name.text))
    return false;
  let found = false;
  walkAst(declaration, (node) => {
    if (found) return;
    if (
      isPropertySignatureDeclaration(node) &&
      isIdentifier(node.name) &&
      node.name.text === LEGACY_SELECTION_FIELD
    )
      found = true;
  });
  return found;
};

/** @param {import("typescript/unstable/ast").SourceFile} sourceFile */
const violatesProjectContextLegacySelectionAuthority = (sourceFile) => {
  let violation = false;
  walkAst(sourceFile, (node) => {
    if (violation) return;
    if (
      isImportDeclaration(node) ||
      (isExportDeclaration(node) && node.moduleSpecifier !== undefined)
    ) {
      const specifier = staticModuleText(node.moduleSpecifier);
      violation =
        specifier === undefined ||
        isForbiddenProjectContextDependency(specifier);
      return;
    }
    if (
      isCallExpression(node) &&
      node.expression.kind === AstSyntaxKind.ImportKeyword
    ) {
      const specifier = staticModuleText(node.arguments[0]);
      violation =
        specifier === undefined ||
        isForbiddenProjectContextDependency(specifier);
      return;
    }
    if (isImportTypeNode(node)) {
      const argument = node.argument;
      const specifier = isLiteralTypeNode(argument)
        ? staticModuleText(argument.literal)
        : undefined;
      violation =
        specifier === undefined ||
        isForbiddenProjectContextDependency(specifier);
      return;
    }
    if (isInterfaceDeclaration(node) || isTypeAliasDeclaration(node))
      violation = declaresLegacySelectionInput(node);
  });
  return violation;
};

/** @param {import("typescript/unstable/ast").SourceFile} sourceFile */
const violatesSourcePriceRefreshProductCaptureImports = (sourceFile) => {
  let allowedImports = 0;
  let violation = false;
  walkAst(sourceFile, (node) => {
    if (violation) return;
    if (isImportDeclaration(node)) {
      const specifier = staticModuleText(node.moduleSpecifier);
      if (specifier === undefined) return;
      if (!/(?:^|\/)features\/product-capture\//.test(specifier)) return;
      const clause = node.importClause;
      const named = clause?.namedBindings;
      if (
        !/^.*\/features\/product-capture\/public\.(?:js|ts)$/.test(specifier) ||
        clause === undefined ||
        clause.name !== undefined ||
        named === undefined ||
        !isNamedImports(named) ||
        named.elements.length !== 1 ||
        named.elements[0]?.propertyName !== undefined ||
        named.elements[0]?.name.text !== "PagePriceExtractionPort"
      ) {
        violation = true;
        return;
      }
      allowedImports += 1;
      return;
    }
    if (isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
      const specifier = staticModuleText(node.moduleSpecifier);
      if (
        specifier === undefined ||
        /(?:^|\/)features\/product-capture\//.test(specifier)
      )
        violation = true;
      return;
    }
    if (
      isCallExpression(node) &&
      node.expression.kind === AstSyntaxKind.ImportKeyword
    ) {
      const specifier = staticModuleText(node.arguments[0]);
      if (
        specifier === undefined ||
        /(?:^|\/)features\/product-capture\//.test(specifier)
      )
        violation = true;
      return;
    }
    if (isImportTypeNode(node)) {
      const specifier = isLiteralTypeNode(node.argument)
        ? staticModuleText(node.argument.literal)
        : undefined;
      if (
        specifier === undefined ||
        /(?:^|\/)features\/product-capture\//.test(specifier)
      )
        violation = true;
    }
  });
  return violation || allowedImports !== 1;
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
        const isSourcePriceRefreshUpstreamConsumer =
          /(?:^|\/)tests\/tooling\/source-price-refresh-(?:upstream|public)-consumer\.ts$/.test(
            normalizedPath,
          );
        const isCandidateSourceBookmarks =
          /(?:^|\/)src\/features\/candidate-source-bookmarks\//.test(
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
            token.kind === SyntaxKind.StringLiteral &&
            isForbiddenVendorSchemaImport(normalizedPath, token.value) &&
            tokens
              .slice(Math.max(0, index - 4), index)
              .some(({ kind }) =>
                [SyntaxKind.ImportKeyword, SyntaxKind.FromKeyword].includes(
                  kind,
                ),
              )
          )
            rules.add("canonical-runtime-schema-import-only");
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
            isForbiddenSourcePriceRefreshShellImport(
              normalizedPath,
              token.value,
            ) &&
            tokens
              .slice(Math.max(0, index - 4), index)
              .some(({ kind }) =>
                [SyntaxKind.ImportKeyword, SyntaxKind.FromKeyword].includes(
                  kind,
                ),
              )
          )
            rules.add("source-price-refresh-shell-public-dependencies-only");
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
          if (
            token.kind === SyntaxKind.StringLiteral &&
            isForbiddenProjectContextConsumerImport(
              normalizedPath,
              token.value,
            ) &&
            tokens
              .slice(Math.max(0, index - 4), index)
              .some(({ kind }) =>
                [SyntaxKind.ImportKeyword, SyntaxKind.FromKeyword].includes(
                  kind,
                ),
              )
          )
            rules.add("project-context-consumer-public-entry-only");
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
        if (isSourcePriceRefreshUpstreamConsumer) {
          if (
            ast !== undefined &&
            violatesSourcePriceRefreshProductCaptureImports(ast)
          )
            rules.add("source-price-refresh-product-capture-price-port-only");
        }
        if (
          isCandidateSourceBookmarks &&
          /\bCaptureCandidatePort\b/.test(source)
        )
          rules.add("candidate-source-bookmarks-no-legacy-capture-port");
        if (
          PROJECT_CONTEXT_STORAGE_ADAPTER.test(normalizedPath) &&
          ast !== undefined &&
          violatesProjectContextPreferenceKey(ast)
        )
          rules.add("project-context-preference-key-only");
        if (
          PROJECT_CONTEXT_SOURCE.test(normalizedPath) &&
          ast !== undefined &&
          violatesProjectContextLegacySelectionAuthority(ast)
        )
          rules.add("project-context-no-legacy-selection-authority");
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
          /\bgetSnapshot\s*:\s*(?:async\s*)?\(?.*?=>[\s\S]{0,500}?status\s*:\s*["']inactive["'][\s\S]{0,500}?\bsubscribe\s*:\s*\(?.*?=>\s*\(?.*?=>\s*\{\s*\}/.test(
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

// StorageAccessGuard (3.2, 3.4, and project-context 8.1/8.4):
// `chrome.storage.local` reachability is confined to the local-data foundation
// adapter, the display-language preference port, and the project-context
// preference adapter (whose dedicated key is additionally gated above).
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
    pattern: /(?:^|\/)project-context\/preference-store\.ts$/,
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
