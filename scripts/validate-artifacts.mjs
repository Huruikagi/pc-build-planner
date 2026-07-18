import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const requiredCsp = "script-src 'self'; object-src 'self'";
const JavaScriptExtensions = new Set([".js", ".mjs", ".cjs"]);
const HtmlExtensions = new Set([".html", ".htm"]);

/** @param {string} message */
function fail(message) {
  throw new Error(`Artifact validation failed: ${message}`);
}

/**
 * @param {{ manifest_version?: unknown, minimum_chrome_version?: unknown,
 * permissions?: unknown, content_security_policy?: { extension_pages?: unknown },
 * [key: string]: unknown }} manifest
 */
export function validateManifest(manifest) {
  if (
    manifest === null ||
    typeof manifest !== "object" ||
    Array.isArray(manifest)
  ) {
    fail("manifest.json must contain an object");
  }
  if (manifest.manifest_version !== 3) fail("manifest_version must be 3");
  if (manifest.minimum_chrome_version !== "116") {
    fail("minimum_chrome_version must be 116");
  }
  if (
    !Array.isArray(manifest.permissions) ||
    manifest.permissions.length !== 1 ||
    manifest.permissions[0] !== "storage"
  ) {
    fail("storage must be the only permission");
  }
  if (
    "host_permissions" in manifest ||
    "optional_host_permissions" in manifest ||
    "optional_permissions" in manifest
  ) {
    fail("host and optional permissions are not allowed");
  }
  if (manifest.content_security_policy?.extension_pages !== requiredCsp) {
    fail("extension page CSP must allow only bundled scripts and objects");
  }
}

/** @param {string} directory @returns {Promise<string[]>} */
async function artifactFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await artifactFiles(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

/** @param {string} source @param {string} path */
function validateJavaScript(source, path) {
  /** @type {Array<readonly [RegExp, string]>} */
  const checks = [
    [
      /\b(?:import|export)\s*(?:\([^)]*\)|[^;]*)\bhttps?:\/\//i,
      "remote import",
    ],
    [/\bimportScripts\s*\(\s*["']https?:\/\//i, "remote importScripts"],
    [/\beval\s*\(/, "eval"],
    [/\bnew\s+Function\s*\(/, "new Function"],
  ];
  for (const [pattern, label] of checks) {
    if (pattern.test(source)) fail(`${label} found in ${path}`);
  }
}

/** @param {string} source @param {string} path */
function validateHtml(source, path) {
  if (/<script\b[^>]*>(?!\s*<\/script>)[\s\S]*?<\/script>/i.test(source)) {
    fail(`inline script found in ${path}`);
  }
  if (
    /\son[a-z]+\s*=/i.test(source) ||
    /(?:href|src)\s*=\s*["']\s*javascript:/i.test(source)
  ) {
    fail(`inline JavaScript found in ${path}`);
  }
  if (/<script\b[^>]+src\s*=\s*["']\s*https?:\/\//i.test(source)) {
    fail(`remote script found in ${path}`);
  }
}

/** @param {string} directory */
export async function validateArtifactDirectory(directory) {
  const manifest = JSON.parse(
    await readFile(join(directory, "manifest.json"), "utf8"),
  );
  validateManifest(manifest);

  for (const path of await artifactFiles(directory)) {
    const extension = extname(path).toLowerCase();
    if (!JavaScriptExtensions.has(extension) && !HtmlExtensions.has(extension))
      continue;
    const source = await readFile(path, "utf8");
    if (JavaScriptExtensions.has(extension)) validateJavaScript(source, path);
    else validateHtml(source, path);
  }
}

if (
  process.argv[1] &&
  import.meta.url === new URL(process.argv[1], "file:").href
) {
  await validateArtifactDirectory(process.argv[2] ?? "dist");
}
