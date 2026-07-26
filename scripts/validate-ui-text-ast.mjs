import { readFileSync } from "node:fs";
import { SyntaxKind } from "typescript/unstable/ast";
import { createVirtualFileSystem } from "typescript/unstable/fs";
import { API } from "typescript/unstable/sync";

/**
 * @typedef {{ readonly path: string, readonly source: string }} SourceFile
 * @typedef {{ readonly path: string, readonly line: number, readonly rule: string }} UiTextViolation
 * @typedef {import("typescript/unstable/ast").Node} AstNode
 * @typedef {import("typescript/unstable/ast").SourceFile} AstSourceFile
 */

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

/** @param {string} value */
const containsDisplayText = (value) =>
  NATURAL_LANGUAGE.test(value) || ENGLISH_DISPLAY_TEXT.test(value);
const CODE_SHAPED_LITERAL = /^(?:[a-z][A-Za-z0-9_./:@-]*|)$/;
const NAMED_CODE_LITERAL = /^(?:[a-z0-9_./:@-]+|)$/;
const EXPLICIT_CODE_SHAPE = /[._:/@-]/;
const NON_DISPLAY_CONSTRUCTORS = new Set([
  "AggregateError",
  "Error",
  "Map",
  "Set",
  "TypeError",
  "URL",
]);
const CODE_ARGUMENT_APIS = new Set([
  "errorFor",
  "fieldEntry",
  "includes",
  "isValidQuantity",
  "join",
  "message",
  "messages",
  "partyName",
  "resolvedFieldText",
  "setProductText",
  "setSourceText",
]);
const CODE_VARIABLE_NAMES = new Set([
  "CUSTOM_OPTION",
  "action",
  "diagnosticCode",
  "featureId",
  "featureSlotMarker",
  "fieldName",
  "id",
  "messageKey",
]);

/** @param {any} expression @returns {any[]} */
const renderedStringNodes = (expression) => {
  if (expression === undefined) return [];
  if (
    expression.kind === SyntaxKind.StringLiteral ||
    expression.kind === SyntaxKind.NoSubstitutionTemplateLiteral
  )
    return [expression];
  if (expression.kind === SyntaxKind.TemplateExpression)
    return [
      expression.head,
      ...expression.templateSpans.flatMap((/** @type {any} */ span) => [
        ...renderedStringNodes(span.expression),
        span.literal,
      ]),
    ];
  if (expression.kind === SyntaxKind.ConditionalExpression)
    return [
      ...renderedStringNodes(expression.whenTrue),
      ...renderedStringNodes(expression.whenFalse),
    ];
  if (expression.kind === SyntaxKind.ArrayLiteralExpression)
    return expression.elements.flatMap(renderedStringNodes);
  if (
    expression.kind === SyntaxKind.ParenthesizedExpression ||
    expression.kind === SyntaxKind.AsExpression ||
    expression.kind === SyntaxKind.SatisfiesExpression ||
    expression.kind === SyntaxKind.NonNullExpression ||
    expression.kind === SyntaxKind.TypeAssertionExpression
  )
    return renderedStringNodes(expression.expression);
  if (expression.kind !== SyntaxKind.BinaryExpression) return [];
  const operator = expression.operatorToken.kind;
  if (
    operator === SyntaxKind.PlusToken ||
    operator === SyntaxKind.AmpersandAmpersandToken ||
    operator === SyntaxKind.BarBarToken ||
    operator === SyntaxKind.QuestionQuestionToken
  )
    return [
      ...renderedStringNodes(expression.left),
      ...renderedStringNodes(expression.right),
    ];
  if (operator === SyntaxKind.CommaToken)
    return renderedStringNodes(expression.right);
  return [];
};

/** @param {any} name @returns {string | undefined} */
const staticName = (name) =>
  name?.kind === SyntaxKind.Identifier ||
  name?.kind === SyntaxKind.StringLiteral ||
  name?.kind === SyntaxKind.NoSubstitutionTemplateLiteral
    ? name.text.toLowerCase()
    : undefined;

/** @param {any} initializer @returns {any} */
const attributeExpression = (initializer) =>
  initializer?.kind === SyntaxKind.JsxExpression
    ? initializer.expression
    : initializer;

/** @param {any} expression @returns {string | undefined} */
const staticString = (expression) =>
  expression?.kind === SyntaxKind.StringLiteral ||
  expression?.kind === SyntaxKind.NoSubstitutionTemplateLiteral
    ? expression.text
    : undefined;

/** @param {any} opening @param {string} target @returns {any} */
const staticAttributeExpression = (opening, target) => {
  for (const attribute of opening.attributes.properties) {
    if (
      attribute.kind === SyntaxKind.JsxAttribute &&
      staticName(attribute.name) === target
    )
      return attributeExpression(attribute.initializer);
    if (
      attribute.kind !== SyntaxKind.JsxSpreadAttribute ||
      attribute.expression.kind !== SyntaxKind.ObjectLiteralExpression
    )
      continue;
    for (const property of attribute.expression.properties)
      if (
        property.kind === SyntaxKind.PropertyAssignment &&
        staticName(property.name) === target
      )
        return property.initializer;
  }
  return undefined;
};

/** @param {string} name @param {string} tagName @param {string | undefined} inputType */
const isUserPerceivableAttribute = (name, tagName, inputType) =>
  USER_PERCEIVABLE_ATTRIBUTES.has(name) ||
  name === "label" ||
  (name === "value" &&
    tagName === "input" &&
    (inputType === undefined ||
      ["button", "reset", "submit"].includes(inputType.toLowerCase())));

/** @param {string} selector */
const hasUserPerceivableSelectorValue = (selector) => {
  for (const match of selector.matchAll(
    /\[\s*([\w-]+)[^\]{}]*?=\s*(?:"([^"]*)"|'([^']*)'|([\w-]+))[^\]]*\]/g,
  )) {
    const attribute = (match[1] ?? "").toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (
      (USER_PERCEIVABLE_ATTRIBUTES.has(attribute) || attribute === "label") &&
      ENGLISH_DISPLAY_TEXT.test(value)
    )
      return true;
  }
  return false;
};

/** @param {any} node @param {AstSourceFile} ast */
const isAllowedCodeLiteral = (node, ast) => {
  const value = node.text ?? "";
  const parent = node.parent;
  let callAncestor = parent;
  while (
    callAncestor !== undefined &&
    callAncestor.kind !== SyntaxKind.CallExpression &&
    callAncestor.kind !== SyntaxKind.NewExpression &&
    callAncestor.kind !== SyntaxKind.ArrowFunction &&
    callAncestor.kind !== SyntaxKind.FunctionExpression &&
    callAncestor.kind !== SyntaxKind.FunctionDeclaration
  )
    callAncestor = callAncestor.parent;
  if (callAncestor?.kind === SyntaxKind.CallExpression) {
    const callee = callAncestor.expression.getText(ast);
    const calleeName = callee.split(".").at(-1) ?? callee;
    if (calleeName === "querySelector")
      return !hasUserPerceivableSelectorValue(value);
    if (CODE_ARGUMENT_APIS.has(calleeName) && CODE_SHAPED_LITERAL.test(value))
      return true;
  }
  let attributeAncestor = parent;
  while (
    attributeAncestor !== undefined &&
    attributeAncestor.kind !== SyntaxKind.JsxAttribute &&
    attributeAncestor.kind !== SyntaxKind.ArrowFunction &&
    attributeAncestor.kind !== SyntaxKind.FunctionExpression &&
    attributeAncestor.kind !== SyntaxKind.FunctionDeclaration
  )
    attributeAncestor = attributeAncestor.parent;
  if (attributeAncestor?.kind === SyntaxKind.JsxAttribute) {
    const opening = attributeAncestor.parent.parent;
    const name = staticName(attributeAncestor.name) ?? "";
    const tagName = opening.tagName.getText(ast).toLowerCase();
    const inputType = staticString(staticAttributeExpression(opening, "type"));
    return !isUserPerceivableAttribute(name, tagName, inputType);
  }
  let propertyAncestor = parent;
  while (
    propertyAncestor !== undefined &&
    propertyAncestor.kind !== SyntaxKind.PropertyAssignment &&
    propertyAncestor.kind !== SyntaxKind.VariableDeclaration &&
    propertyAncestor.kind !== SyntaxKind.ArrowFunction &&
    propertyAncestor.kind !== SyntaxKind.FunctionExpression &&
    propertyAncestor.kind !== SyntaxKind.FunctionDeclaration
  )
    propertyAncestor = propertyAncestor.parent;
  if (propertyAncestor?.kind === SyntaxKind.PropertyAssignment) {
    if (propertyAncestor.name === node) return true;
    const propertyName = staticName(propertyAncestor.name) ?? "";
    if (
      USER_PERCEIVABLE_ATTRIBUTES.has(propertyName) ||
      propertyName === "label"
    )
      return false;
    if (
      ["code", "key", "kind", "labelkey", "type"].includes(propertyName) &&
      CODE_SHAPED_LITERAL.test(value)
    )
      return true;
    let bindingAncestor = propertyAncestor.parent;
    while (
      bindingAncestor !== undefined &&
      bindingAncestor.kind !== SyntaxKind.VariableDeclaration &&
      bindingAncestor.kind !== SyntaxKind.ArrowFunction &&
      bindingAncestor.kind !== SyntaxKind.FunctionExpression &&
      bindingAncestor.kind !== SyntaxKind.FunctionDeclaration
    )
      bindingAncestor = bindingAncestor.parent;
    const bindingName =
      bindingAncestor?.kind === SyntaxKind.VariableDeclaration
        ? bindingAncestor.name.getText(ast)
        : "";
    return (
      (/(?:MessageKeys|MESSAGE_KEYS)$/.test(bindingName) ||
        bindingName === "RULE_LABEL_KEYS") &&
      CODE_SHAPED_LITERAL.test(value) &&
      value.includes(".")
    );
  }
  if (
    parent?.kind === SyntaxKind.ImportDeclaration ||
    parent?.kind === SyntaxKind.ExportDeclaration ||
    parent?.kind === SyntaxKind.ExternalModuleReference ||
    parent?.kind === SyntaxKind.LiteralType ||
    parent?.kind === SyntaxKind.TemplateLiteralType ||
    parent?.kind === SyntaxKind.CaseClause
  )
    return true;
  if (parent?.kind === SyntaxKind.NewExpression) {
    const constructorName = parent.expression.getText(ast).split(".").at(-1);
    return NON_DISPLAY_CONSTRUCTORS.has(constructorName ?? "");
  }
  if (parent?.kind === SyntaxKind.BinaryExpression) {
    const isCodeComparison =
      CODE_SHAPED_LITERAL.test(value) &&
      [
        SyntaxKind.EqualsEqualsToken,
        SyntaxKind.EqualsEqualsEqualsToken,
        SyntaxKind.ExclamationEqualsToken,
        SyntaxKind.ExclamationEqualsEqualsToken,
        SyntaxKind.InKeyword,
      ].includes(parent.operatorToken.kind);
    if (isCodeComparison) return true;
  }
  if (parent?.kind === SyntaxKind.CallExpression) {
    const callee = parent.expression.getText(ast);
    const calleeName = callee.split(".").at(-1) ?? callee;
    if (calleeName === "querySelector")
      return !hasUserPerceivableSelectorValue(value);
    return (
      CODE_SHAPED_LITERAL.test(value) && CODE_ARGUMENT_APIS.has(calleeName)
    );
  }
  if (
    parent?.kind === SyntaxKind.AsExpression &&
    parent.parent?.kind === SyntaxKind.PropertyAssignment
  ) {
    const propertyName = staticName(parent.parent.name) ?? "";
    return (
      ["code", "key", "kind", "labelkey", "type"].includes(propertyName) &&
      CODE_SHAPED_LITERAL.test(value)
    );
  }
  let variableAncestor = parent;
  while (
    variableAncestor !== undefined &&
    variableAncestor.kind !== SyntaxKind.VariableDeclaration &&
    variableAncestor.kind !== SyntaxKind.ArrowFunction &&
    variableAncestor.kind !== SyntaxKind.FunctionExpression &&
    variableAncestor.kind !== SyntaxKind.FunctionDeclaration
  )
    variableAncestor = variableAncestor.parent;
  if (variableAncestor?.kind === SyntaxKind.VariableDeclaration) {
    const variableName = variableAncestor.name?.getText(ast) ?? "";
    const isNamedCodeVariable =
      NAMED_CODE_LITERAL.test(value) && CODE_VARIABLE_NAMES.has(variableName);
    if (isNamedCodeVariable) return true;
  }
  if (parent?.kind === SyntaxKind.ConditionalExpression)
    return CODE_SHAPED_LITERAL.test(value) && EXPLICIT_CODE_SHAPE.test(value);
  if (
    parent?.kind === SyntaxKind.ArrayLiteralExpression &&
    parent.parent?.kind === SyntaxKind.NewExpression
  ) {
    const constructorName = parent.parent.expression
      .getText(ast)
      .split(".")
      .at(-1);
    return (
      CODE_SHAPED_LITERAL.test(value) &&
      NON_DISPLAY_CONSTRUCTORS.has(constructorName ?? "")
    );
  }
  let templateAncestor = parent;
  while (
    templateAncestor !== undefined &&
    templateAncestor.kind !== SyntaxKind.TemplateExpression &&
    templateAncestor.kind !== SyntaxKind.ArrowFunction &&
    templateAncestor.kind !== SyntaxKind.FunctionExpression &&
    templateAncestor.kind !== SyntaxKind.FunctionDeclaration
  )
    templateAncestor = templateAncestor.parent;
  if (templateAncestor?.kind === SyntaxKind.TemplateExpression) {
    const templateCodeShape = [
      templateAncestor.head.text,
      ...templateAncestor.templateSpans.map(
        (/** @type {any} */ span) => span.literal.text,
      ),
    ].join("");
    return (
      CODE_SHAPED_LITERAL.test(value) &&
      EXPLICIT_CODE_SHAPE.test(templateCodeShape)
    );
  }
  if (parent?.kind === SyntaxKind.ReturnStatement) {
    let functionAncestor = parent.parent;
    while (
      functionAncestor !== undefined &&
      functionAncestor.kind !== SyntaxKind.ArrowFunction &&
      functionAncestor.kind !== SyntaxKind.FunctionExpression &&
      functionAncestor.kind !== SyntaxKind.FunctionDeclaration
    )
      functionAncestor = functionAncestor.parent;
    const binding =
      functionAncestor?.kind === SyntaxKind.FunctionDeclaration
        ? functionAncestor.name?.getText(ast)
        : functionAncestor?.parent?.kind === SyntaxKind.VariableDeclaration
          ? functionAncestor.parent.name.getText(ast)
          : undefined;
    return (
      CODE_SHAPED_LITERAL.test(value) && /(?:Code|Id|Key)$/.test(binding ?? "")
    );
  }
  return false;
};

/** @param {SourceFile} file @param {AstSourceFile} ast @returns {UiTextViolation[]} */
const findViolations = (file, ast) => {
  /** @type {UiTextViolation[]} */
  const violations = [];
  const reportedOffsets = new Set();
  /** @param {any} textNode @param {string} rule */
  const report = (textNode, rule) => {
    if (!containsDisplayText(textNode.text ?? "")) return;
    const offset = textNode.getStart(ast);
    if (reportedOffsets.has(offset)) return;
    reportedOffsets.add(offset);
    violations.push({
      path: file.path,
      line: file.source.slice(0, offset).split("\n").length,
      rule,
    });
  };
  /** @param {any} opening @param {any} attribute @param {string} name */
  const reportAttribute = (opening, attribute, name) => {
    const tagName = opening.tagName.getText(ast).toLowerCase();
    const inputType = staticString(staticAttributeExpression(opening, "type"));
    if (!isUserPerceivableAttribute(name, tagName, inputType)) return;
    const expression =
      attribute.kind === SyntaxKind.JsxAttribute
        ? attributeExpression(attribute.initializer)
        : attribute.initializer;
    for (const rendered of renderedStringNodes(expression))
      report(rendered, "no-natural-language-jsx-attribute");
  };
  /** @param {AstNode} node */
  const visit = (node) => {
    const current = /** @type {any} */ (node);
    if (current.kind === SyntaxKind.JsxText)
      report(current, "no-natural-language-jsx-text");
    else if (
      current.kind === SyntaxKind.JsxExpression &&
      (current.parent.kind === SyntaxKind.JsxElement ||
        current.parent.kind === SyntaxKind.JsxFragment)
    )
      for (const rendered of renderedStringNodes(current.expression))
        report(rendered, "no-natural-language-jsx-expression-child");
    else if (current.kind === SyntaxKind.JsxAttribute) {
      reportAttribute(
        current.parent.parent,
        current,
        staticName(current.name) ?? "",
      );
    } else if (
      current.kind === SyntaxKind.JsxSpreadAttribute &&
      current.expression.kind === SyntaxKind.ObjectLiteralExpression
    ) {
      for (const property of current.expression.properties)
        if (property.kind === SyntaxKind.PropertyAssignment)
          reportAttribute(
            current.parent.parent,
            property,
            staticName(property.name) ?? "",
          );
    }
    if (
      (current.kind === SyntaxKind.StringLiteral ||
        current.kind === SyntaxKind.NoSubstitutionTemplateLiteral ||
        current.kind === SyntaxKind.TemplateHead ||
        current.kind === SyntaxKind.TemplateMiddle ||
        current.kind === SyntaxKind.TemplateTail) &&
      ENGLISH_DISPLAY_TEXT.test(current.text ?? "") &&
      !isAllowedCodeLiteral(current, ast)
    )
      report(current, "no-natural-language-english-literal");
    node.forEachChild(visit);
  };
  visit(ast);
  return violations;
};

/** @type {SourceFile[]} */
const sources = JSON.parse(readFileSync(0, "utf8"));
const virtualPaths = sources.map((_, index) => `/ui-text/${index}.tsx`);
const fileSystem = createVirtualFileSystem(
  Object.fromEntries(
    sources.map((file, index) => [virtualPaths[index], file.source]),
  ),
);
const api = new API({ cwd: "/", fs: fileSystem });
/** @type {import("typescript/unstable/sync").Snapshot | undefined} */
let snapshot;
try {
  snapshot = api.updateSnapshot({ openFiles: virtualPaths });
  const activeSnapshot = snapshot;
  const violations = sources.flatMap((file, index) => {
    const virtualPath = virtualPaths[index];
    if (virtualPath === undefined)
      throw new Error(`ui-text parser path missing: ${file.path}`);
    const ast = activeSnapshot
      .getDefaultProjectForFile(virtualPath)
      ?.program.getSourceFile(virtualPath);
    if (ast === undefined)
      throw new Error(`ui-text parser could not load: ${file.path}`);
    return findViolations(file, ast);
  });
  process.stdout.write(JSON.stringify(violations));
} finally {
  snapshot?.dispose();
  api.close();
}
