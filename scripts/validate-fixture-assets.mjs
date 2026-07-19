import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

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

/** @typedef {{ readonly path: string, readonly content: string }} FixtureFile */

/** @param {string} directory @returns {Promise<FixtureFile[]>} */
const collect = async (directory) => {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collect(path)));
    else if (entry.isFile() && !/\.test\.[cm]?[jt]s$/i.test(entry.name))
      files.push({ path, content: await readFile(path, "utf8") });
  }
  return files;
};

/** @param {string | undefined} directory @param {readonly FixtureFile[]} supplied */
export async function findFixtureAssetViolations(directory, supplied = []) {
  const files = directory === undefined ? supplied : await collect(directory);
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
    if (Object.hasOwn(value, "original")) {
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

if (
  process.argv[1] &&
  import.meta.url === new URL(process.argv[1], "file:").href
) {
  const violations = await findFixtureAssetViolations(
    process.argv[2] ?? "tests/fixtures",
  );
  for (const violation of violations)
    console.error(`${violation.path}: ${violation.rule}`);
  if (violations.length > 0) process.exitCode = 1;
}
