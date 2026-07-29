import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { SyntaxKind } from "typescript/unstable/ast";
import {
  isArrayLiteralExpression,
  isAsExpression,
  isBinaryExpression,
  isComputedPropertyName,
  isIdentifier,
  isNonNullExpression,
  isNoSubstitutionTemplateLiteral,
  isObjectLiteralExpression,
  isParenthesizedExpression,
  isPropertyAssignment,
  isSatisfiesExpression,
  isShorthandPropertyAssignment,
  isSpreadAssignment,
  isSpreadElement,
  isStringLiteral,
  isVariableDeclaration,
} from "typescript/unstable/ast/is";
import { withTypeScriptAsts } from "./typescript-ast.mjs";

const imageExtensions = new Set([
  ".avif",
  ".bmp",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
]);
const rawHtml = /<(?:!doctype\s+html|!--|\/?[a-z][^>]*>)/i;
const dataUrl = /\bdata:[^\s"']+/i;
const webUrl = /https?:\/\/[^\s"'`)]+/gi;
const syntheticValue = /(?:架空|synthetic|^SYN(?:-|$))/i;
const registrableDomainLiteral =
  /["']?registrableDomain["']?\s*:\s*["']([^"']+)["']/g;

/** @typedef {{ readonly path: string, readonly content: string }} FixtureFile */

/**
 * @param {string} directory
 * @param {(path: string) => boolean} shouldInspectPath
 * @returns {Promise<FixtureFile[]>}
 */
const collect = async (directory, shouldInspectPath) => {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory())
      files.push(...(await collect(path, shouldInspectPath)));
    else if (
      entry.isFile() &&
      !/\.test\.[cm]?[jt]s$/i.test(entry.name) &&
      shouldInspectPath(path)
    )
      files.push({ path, content: await readFile(path, "utf8") });
  }
  return files;
};

/**
 * @param {string | undefined} directory
 * @param {readonly FixtureFile[]} supplied
 * @param {(path: string) => boolean} shouldInspectPath
 */
export async function findFixtureAssetViolations(
  directory,
  supplied = [],
  shouldInspectPath = () => true,
) {
  const files =
    directory === undefined
      ? supplied.filter(({ path }) => shouldInspectPath(path))
      : await collect(directory, shouldInspectPath);
  return files.flatMap(({ path, content }) => {
    const rules = [];
    const extension = extname(path).toLowerCase();
    const isCode = [".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"].includes(
      extension,
    );
    const inspected = isCode
      ? [...content.matchAll(/(["'`])((?:\\.|(?!\1)[\s\S])*)\1/g)]
          .map((match) => match[2] ?? "")
          .join("\n")
      : content;
    if (rawHtml.test(inspected)) rules.push("raw-html");
    if (imageExtensions.has(extname(path).toLowerCase()))
      rules.push("image-file");
    if (dataUrl.test(inspected)) rules.push("data-url");
    for (const match of content.matchAll(registrableDomainLiteral)) {
      const domain = match[1] ?? "";
      if (
        domain !== "example.invalid" &&
        !domain.endsWith(".example.invalid")
      ) {
        rules.push("non-synthetic-domain");
        break;
      }
    }
    for (const match of inspected.matchAll(webUrl)) {
      const hostname = new URL(match[0]).hostname;
      if (
        hostname !== "example.invalid" &&
        !hostname.endsWith(".example.invalid")
      ) {
        rules.push("non-synthetic-url");
        break;
      }
    }
    return rules.map((rule) => ({ path, rule }));
  });
}

/**
 * 商品fixtureの自由記述値には合成markerを必須とする。未知形状も許可せず、
 * 実商品名や型番の個別blacklistに依存しない。
 * @param {unknown} root
 */
export function findFixtureValueViolations(root) {
  if (root === null || typeof root !== "object" || Array.isArray(root))
    return [{ path: "$", rule: "invalid-fixture-root" }];
  /** @type {Array<{ path: string, rule: string }>} */
  const violations = [];
  /** @param {unknown} value @param {string} path */
  const walk = (value, path) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        walk(item, `${path}[${index}]`);
      });
      return;
    }
    if (value === null || typeof value !== "object") return;
    const record = /** @type {Record<string, unknown>} */ (value);
    const isSource = /(?:^|\.)sources\[\d+\]$/.test(path);
    if (isSource && Object.hasOwn(record, "pageUrl")) {
      try {
        const pageUrl = new URL(String(record.pageUrl));
        if (
          !["http:", "https:"].includes(pageUrl.protocol) ||
          (pageUrl.hostname !== "example.invalid" &&
            !pageUrl.hostname.endsWith(".example.invalid"))
        )
          throw new Error("non-synthetic source URL");
      } catch {
        violations.push({
          path: `${path}.pageUrl`,
          rule: "non-synthetic-source-url",
        });
      }
    }
    if (
      isSource &&
      Object.hasOwn(record, "siteName") &&
      (typeof record.siteName !== "string" ||
        !syntheticValue.test(record.siteName) ||
        rawHtml.test(record.siteName) ||
        dataUrl.test(record.siteName))
    ) {
      violations.push({
        path: `${path}.siteName`,
        rule: "non-synthetic-source-site-name",
      });
    }
    if (isSource && Object.hasOwn(record, "price")) {
      const price = record.price;
      const priceRecord =
        price !== null && typeof price === "object"
          ? /** @type {Record<string, unknown>} */ (price)
          : undefined;
      /** @type {string[]} */
      const priceStrings = [];
      /** @param {unknown} candidate */
      const collectPriceStrings = (candidate) => {
        if (typeof candidate === "string") priceStrings.push(candidate);
        else if (Array.isArray(candidate))
          candidate.forEach(collectPriceStrings);
        else if (candidate !== null && typeof candidate === "object")
          Object.values(candidate).forEach(collectPriceStrings);
      };
      collectPriceStrings(price);
      const confirmed = priceRecord?.confirmed;
      const amount =
        confirmed !== null && typeof confirmed === "object"
          ? /** @type {Record<string, unknown>} */ (confirmed).amount
          : undefined;
      const currency =
        confirmed !== null && typeof confirmed === "object"
          ? /** @type {Record<string, unknown>} */ (confirmed).currency
          : undefined;
      if (
        typeof priceRecord?.original !== "string" ||
        !syntheticValue.test(priceRecord.original) ||
        typeof amount !== "number" ||
        !Number.isFinite(amount) ||
        currency !== "SYN"
      )
        violations.push({
          path: `${path}.price`,
          rule: "non-synthetic-source-price",
        });
      if (priceStrings.some((text) => rawHtml.test(text) || dataUrl.test(text)))
        violations.push({
          path: `${path}.price`,
          rule: "unsafe-synthetic-source-price",
        });
    }
    const isSourcePrice = /(?:^|\.)sources\[\d+\]\.price$/.test(path);
    if (Object.hasOwn(record, "original") && !isSourcePrice) {
      /** @type {string[]} */
      const strings = [];
      /** @param {unknown} sourcedValue */
      const collectStrings = (sourcedValue) => {
        if (typeof sourcedValue === "string") strings.push(sourcedValue);
        else if (Array.isArray(sourcedValue))
          sourcedValue.forEach(collectStrings);
        else if (sourcedValue !== null && typeof sourcedValue === "object")
          Object.values(sourcedValue).forEach(collectStrings);
      };
      collectStrings(value);
      if (strings.some((value) => !syntheticValue.test(value)))
        violations.push({
          path,
          rule: "non-synthetic-sourced-value",
        });
      return;
    }
    for (const [key, child] of Object.entries(value))
      walk(child, `${path}.${key}`);
  };
  walk(root, "$");
  return violations;
}

/** @param {string} registryPath */
export async function findFixtureRegistryViolations(registryPath) {
  const registry = await import(pathToFileURL(registryPath).href);
  const fixtures = registry.syntheticSourceFixtures;
  if (!Array.isArray(fixtures))
    return [{ path: registryPath, rule: "invalid-source-fixture-registry" }];
  const names = new Set();
  return fixtures.flatMap((fixture, index) => {
    if (
      fixture === null ||
      typeof fixture !== "object" ||
      typeof fixture.name !== "string" ||
      fixture.name.trim().length === 0 ||
      typeof fixture.module !== "string" ||
      fixture.module.trim().length === 0 ||
      !Object.hasOwn(fixture, "value")
    )
      return [
        {
          path: `${registryPath}#${index}`,
          rule: "invalid-source-fixture-registry",
        },
      ];
    const duplicate = names.has(fixture.name);
    names.add(fixture.name);
    const valueViolations = findFixtureValueViolations(fixture.value).map(
      ({ path, rule }) => ({
        path: `${registryPath}#${fixture.name}${path}`,
        rule,
      }),
    );
    return duplicate
      ? [
          {
            path: `${registryPath}#${fixture.name}`,
            rule: "duplicate-source-fixture-name",
          },
          ...valueViolations,
        ]
      : valueViolations;
  });
}

/** @param {import("typescript/unstable/ast").Node} root @param {(node: import("typescript/unstable/ast").Node) => void} visitor */
const walkFixtureAst = (root, visitor) => {
  visitor(root);
  root.forEachChild((child) => {
    walkFixtureAst(child, visitor);
  });
};

/** @param {import("typescript/unstable/ast").Node} node */
const unwrapFixtureExpression = (node) => {
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

/** @param {import("typescript/unstable/ast").Node} node @param {ReadonlyMap<string, string>} strings @returns {string | undefined} */
const staticFixtureString = (node, strings) => {
  const expression = unwrapFixtureExpression(node);
  if (
    isStringLiteral(expression) ||
    isNoSubstitutionTemplateLiteral(expression)
  )
    return expression.text;
  if (isIdentifier(expression)) return strings.get(expression.text);
  if (
    isBinaryExpression(expression) &&
    expression.operatorToken.kind === SyntaxKind.PlusToken
  ) {
    /** @type {string | undefined} */
    const left = staticFixtureString(expression.left, strings);
    /** @type {string | undefined} */
    const right = staticFixtureString(expression.right, strings);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  return undefined;
};

/** @param {import("typescript/unstable/ast").Node} name @param {ReadonlyMap<string, string>} strings */
const fixturePropertyName = (name, strings) => {
  if (isIdentifier(name) || isStringLiteral(name)) return name.text;
  if (isComputedPropertyName(name))
    return staticFixtureString(name.expression, strings);
  return undefined;
};

/** @param {import("typescript/unstable/ast").SourceFile} ast */
const fixtureAstBindings = (ast) => {
  const values = new Map();
  const strings = new Map();
  walkFixtureAst(ast, (node) => {
    if (
      isVariableDeclaration(node) &&
      isIdentifier(node.name) &&
      node.initializer !== undefined
    )
      values.set(node.name.text, node.initializer);
  });
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, value] of values) {
      const text = staticFixtureString(value, strings);
      if (text !== undefined && strings.get(name) !== text) {
        strings.set(name, text);
        changed = true;
      }
    }
  }
  return { values, strings };
};

/** @param {import("typescript/unstable/ast").Node} value @param {ReadonlyMap<string, import("typescript/unstable/ast").Node>} values @param {ReadonlySet<string>} [seen] */
const resolveFixtureValue = (value, values, seen = new Set()) => {
  const expression = unwrapFixtureExpression(value);
  if (!isIdentifier(expression)) return expression;
  if (seen.has(expression.text)) return expression;
  const next = values.get(expression.text);
  if (next === undefined) return expression;
  return resolveFixtureValue(next, values, new Set([...seen, expression.text]));
};

/** @param {import("typescript/unstable/ast").Node} value @param {ReadonlyMap<string, import("typescript/unstable/ast").Node>} values @param {ReadonlyMap<string, string>} strings @param {ReadonlySet<import("typescript/unstable/ast").Node>} [seen] */
const effectiveObjectProperties = (
  value,
  values,
  strings,
  seen = new Set(),
) => {
  const record = resolveFixtureValue(value, values);
  const properties = new Map();
  if (!isObjectLiteralExpression(record) || seen.has(record)) return properties;
  const nextSeen = new Set([...seen, record]);
  for (const property of record.properties) {
    if (isSpreadAssignment(property)) {
      for (const [name, initializer] of effectiveObjectProperties(
        property.expression,
        values,
        strings,
        nextSeen,
      ))
        properties.set(name, initializer);
      continue;
    }
    if (isPropertyAssignment(property)) {
      const name = fixturePropertyName(property.name, strings);
      if (name !== undefined) properties.set(name, property.initializer);
      continue;
    }
    if (isShorthandPropertyAssignment(property)) {
      const name = fixturePropertyName(property.name, strings);
      if (name !== undefined)
        properties.set(name, values.get(name) ?? property.name);
    }
  }
  return properties;
};

/** @param {import("typescript/unstable/ast").Node} value @param {ReadonlyMap<string, import("typescript/unstable/ast").Node>} values @param {ReadonlySet<import("typescript/unstable/ast").Node>} [seen] @returns {import("typescript/unstable/ast").Node[] | undefined} */
const effectiveArrayElements = (value, values, seen = new Set()) => {
  const array = resolveFixtureValue(value, values);
  if (!isArrayLiteralExpression(array) || seen.has(array)) return undefined;
  const nextSeen = new Set([...seen, array]);
  /** @type {import("typescript/unstable/ast").Node[]} */
  const elements = [];
  for (const element of array.elements) {
    if (isSpreadElement(element)) {
      /** @type {import("typescript/unstable/ast").Node[] | undefined} */
      const spread = effectiveArrayElements(
        element.expression,
        values,
        nextSeen,
      );
      if (spread === undefined) return undefined;
      elements.push(...spread);
    } else elements.push(element);
  }
  return elements;
};

/** @param {import("typescript/unstable/ast").Node} value @param {ReadonlyMap<string, import("typescript/unstable/ast").Node>} values @param {ReadonlyMap<string, string>} strings */
const isSourceCollectionShape = (value, values, strings) => {
  const elements = effectiveArrayElements(value, values);
  if (elements === undefined || elements.length === 0) return false;
  return elements.every((element) => {
    const properties = effectiveObjectProperties(element, values, strings);
    return ["pageUrl", "siteName", "capturedAt", "price"].some((name) =>
      properties.has(name),
    );
  });
};

/** @param {ReadonlyMap<string, import("typescript/unstable/ast").Node>} properties */
const isCandidateRecordShape = (properties) => {
  return (
    properties.has("id") &&
    [
      "projectId",
      "category",
      "product",
      "normalizedAttributes",
      "primarySourceId",
    ].some((name) => properties.has(name))
  );
};

/** @param {import("typescript/unstable/ast").SourceFile} ast */
const hasSourceBearingFixture = (ast) => {
  const { values, strings } = fixtureAstBindings(ast);
  let sourceBearing = false;
  walkFixtureAst(ast, (node) => {
    if (sourceBearing || !isObjectLiteralExpression(node)) return;
    const properties = effectiveObjectProperties(node, values, strings);
    const sources = properties.get("sources");
    if (
      sources !== undefined &&
      (isCandidateRecordShape(properties) ||
        isSourceCollectionShape(sources, values, strings))
    )
      sourceBearing = true;
  });
  return sourceBearing;
};

/**
 * RegistryCompletenessGuard: every source-bearing fixture module is registered,
 * and every registered module is discovered as source-bearing.
 * @param {string} directory
 * @param {string} registryPath
 */
export async function findSourceFixtureRegistryCompletenessViolations(
  directory,
  registryPath,
) {
  const registry = await import(pathToFileURL(registryPath).href);
  const fixtures = /** @type {unknown[]} */ (
    Array.isArray(registry.syntheticSourceFixtures)
      ? registry.syntheticSourceFixtures
      : []
  );
  const registryAbsolute = resolve(registryPath);
  const files = (
    await collect(
      directory,
      (path) =>
        /\.[cm]?[jt]sx?$/i.test(path) && resolve(path) !== registryAbsolute,
    )
  ).map(({ path, content }) => ({ path: resolve(path), source: content }));
  const discovered = withTypeScriptAsts(
    files,
    (asts) =>
      new Set(
        asts.flatMap((ast, index) => {
          const sourceBearing = hasSourceBearingFixture(ast);
          return sourceBearing
            ? [
                relative(
                  resolve(directory),
                  files[index]?.path ?? "",
                ).replaceAll("\\", "/"),
              ]
            : [];
        }),
      ),
  );
  const registered = new Set(
    fixtures.flatMap((fixture) => {
      if (fixture === null || typeof fixture !== "object") return [];
      const record = /** @type {Record<string, unknown>} */ (fixture);
      return typeof record.module === "string"
        ? [record.module.replaceAll("\\", "/")]
        : [];
    }),
  );
  const violations = [];
  for (const module of discovered)
    if (!registered.has(module))
      violations.push({
        path: `${directory}/${module}`,
        rule: "unregistered-source-fixture-module",
      });
  for (const module of registered)
    if (!discovered.has(module))
      violations.push({
        path: `${registryPath}#${module}`,
        rule: "registered-source-fixture-module-missing",
      });
  return violations;
}

/** Domain-map fixtures must never embed a real registrable domain. */
/** @param {unknown} root */
export function findSyntheticDomainViolations(root) {
  /** @type {Array<{ path: string, rule: string }>} */
  const violations = [];
  /** @param {unknown} value @param {string} path */
  const walk = (value, path) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        walk(item, `${path}[${index}]`);
      });
      return;
    }
    if (value === null || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}.${key}`;
      if (
        key === "registrableDomain" &&
        (typeof child !== "string" ||
          (child !== "example.invalid" && !child.endsWith(".example.invalid")))
      ) {
        violations.push({ path: childPath, rule: "non-synthetic-domain" });
      }
      walk(child, childPath);
    }
  };
  walk(root, "$");
  return violations;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const cliArguments = process.argv.slice(2);
  const directory = cliArguments[0] ?? "tests/fixtures";
  const excludeExecutables = cliArguments.includes("--exclude-executables");
  const violations = (
    await findFixtureAssetViolations(
      directory,
      [],
      (path) => !excludeExecutables || !/\.[cm]?js$/i.test(path),
    )
  ).filter(
    ({ path, rule }) =>
      !excludeExecutables ||
      !(extname(path).toLowerCase() === ".html" && rule === "raw-html"),
  );
  const registryPath = cliArguments
    .slice(1)
    .find((argument) => !argument.startsWith("--"));
  if (registryPath !== undefined)
    violations.push(
      ...(await findFixtureRegistryViolations(registryPath)),
      ...(await findSourceFixtureRegistryCompletenessViolations(
        directory,
        registryPath,
      )),
    );
  for (const violation of violations)
    console.error(`${violation.path}: ${violation.rule}`);
  if (violations.length > 0) process.exitCode = 1;
}
