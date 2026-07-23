import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";

const requiredCsp = "script-src 'self'; object-src 'self'";
const JavaScriptExtensions = new Set([".js", ".mjs", ".cjs"]);
const HtmlExtensions = new Set([".html", ".htm"]);

/** @param {string} message @returns {never} */
function fail(message) {
  throw new Error(`Artifact validation failed: ${message}`);
}

const allowedPermissions = new Set(["storage", "activeTab", "scripting"]);

/**
 * @param {{ manifest_version?: unknown, minimum_chrome_version?: unknown,
 * permissions?: unknown, action?: unknown, side_panel?: { default_path?: unknown },
 * background?: { service_worker?: unknown, type?: unknown },
 * content_security_policy?: { extension_pages?: unknown },
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
    manifest.permissions.length === 0 ||
    new Set(manifest.permissions).size !== manifest.permissions.length ||
    !manifest.permissions.every(
      (permission) =>
        typeof permission === "string" && allowedPermissions.has(permission),
    ) ||
    !manifest.permissions.includes("storage")
  ) {
    fail(
      "only the minimal storage, activeTab, scripting permissions are allowed",
    );
  }
  if (
    manifest.action === undefined ||
    manifest.action === null ||
    typeof manifest.action !== "object" ||
    Array.isArray(manifest.action)
  ) {
    fail("action must be declared as an object");
  }
  if (manifest.side_panel?.default_path !== "side-panel.html") {
    fail("side_panel.default_path must be side-panel.html");
  }
  if (
    manifest.background?.service_worker !== "service-worker.js" ||
    manifest.background?.type !== "module"
  ) {
    fail("background service worker must be the bundled module");
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
    [
      /@babel\/standalone|\bBabel\s*\.\s*transform\s*\(|\bjsxDEV\s*\(/,
      "runtime JSX transform",
    ],
    [
      /\bdangerouslySetInnerHTML\s*:|(?:\.|\[\s*["']innerHTML["']\s*\])\s*=/,
      "dangerous HTML rendering API",
    ],
    [
      /\bfeatureContributionCatalog\s*(?:\.\s*(?:push|unshift|splice)\s*\(|\[\s*["'](?:push|unshift|splice)["']\s*\]\s*\()|\b(?:Object\.assign|Reflect\.set)\s*\(\s*featureContributionCatalog\b/,
      "shared entry self-registration",
    ],
    [
      /\bgetSnapshot\s*:\s*(?:async\s*)?\(?.*?=>[\s\S]*?status\s*:\s*["']inactive["'][\s\S]*?\bsubscribe\s*:\s*\(?.*?=>\s*\(?.*?=>\s*\{\s*\}/,
      "dummy maintenance source",
    ],
    [
      /\b(?:onStateChange|observeShellState|subscribeShellState)\s*:\s*\(?.*?=>\s*\{\s*\}/,
      "noop shell state observer",
    ],
  ];
  for (const [pattern, label] of checks) {
    if (pattern.test(source)) fail(`${label} found in ${path}`);
  }
}

const forbiddenFoundationExports = new Set([
  "createChromeStorageAdapter",
  "createCompositionRoot",
  "createLocalDataRepository",
  "createMutationPipeline",
  "createRootTransactionRunner",
  "createWebLocksAdapter",
  "createWriteAuthority",
  "startApplicationShell",
  "startServiceWorker",
]);

/** @param {string} source @param {string} path */
export function validateFoundationPublicContract(source, path) {
  const exportedNames = new Set();
  const exportedBindings = new Set();
  for (const match of source.matchAll(/\bexport\s*\{([\s\S]*?)\}/g)) {
    for (const binding of (match[1] ?? "").split(",")) {
      const names = binding.trim().split(/\s+as\s+/);
      const sourceName = names[0]?.trim();
      const exportedName = names.at(-1)?.trim();
      if (sourceName) exportedBindings.add(sourceName);
      if (exportedName) exportedNames.add(exportedName);
    }
  }
  for (const match of source.matchAll(
    /\bexport\s+(?:(?:async\s+)?function|class)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    const name = match[1];
    if (name) {
      exportedBindings.add(name);
      exportedNames.add(name);
    }
  }
  for (const declaration of source.matchAll(
    /\bexport\s+(?:const|let|var)\s+([^;]+)/g,
  )) {
    for (const binding of (declaration[1] ?? "").matchAll(
      /(?:^|,)\s*([A-Za-z_$][\w$]*)\s*=/g,
    )) {
      const name = binding[1];
      if (name) {
        exportedBindings.add(name);
        exportedNames.add(name);
      }
    }
  }
  if (!exportedNames.has("initializeProductionFoundationRuntimeContribution")) {
    fail(
      `foundation production contribution factory is not exported from ${path}`,
    );
  }
  for (const name of forbiddenFoundationExports) {
    if (exportedBindings.has(name) || exportedNames.has(name)) {
      fail(
        `foundation bundle exposes non-public capability ${name} from ${path}`,
      );
    }
  }
}

/**
 * @param {string} source
 * @param {string} path
 * @returns {Map<string, string>}
 */
function parseScriptAttributes(source, path) {
  const attributes = new Map();
  let remaining = source;
  while (remaining.length > 0) {
    const match = remaining.match(
      /^\s+([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/,
    );
    if (match === null) fail(`malformed script attributes found in ${path}`);
    const name = (match[1] ?? "").toLowerCase();
    if (attributes.has(name)) {
      fail(`duplicate script attribute ${name} found in ${path}`);
    }
    attributes.set(name, match[2] ?? match[3] ?? "");
    remaining = remaining.slice(match[0].length);
  }
  return attributes;
}

/** @param {string} source @param {string} path @returns {string[]} */
function validateHtml(source, path) {
  if (
    /\son[a-z]+\s*=/i.test(source) ||
    /(?:href|src)\s*=\s*["']\s*javascript:/i.test(source)
  ) {
    fail(`inline JavaScript found in ${path}`);
  }
  const referencedScripts = [];
  const scriptStart = /<script\b([^>]*)>/gi;
  for (const match of source.matchAll(scriptStart)) {
    const attributes = parseScriptAttributes(match[1] ?? "", path);
    const contentStart = (match.index ?? 0) + match[0].length;
    const closing = source
      .slice(contentStart)
      .match(/^([\s\S]*?)<\/script\s*>/i);
    if (closing === null) fail(`unclosed script found in ${path}`);
    if ((closing[1] ?? "").trim() !== "") {
      fail(`inline script found in ${path}`);
    }

    if (attributes.get("type")?.toLowerCase() !== "module") {
      fail(`non-module script found in ${path}`);
    }

    const sourceAttribute = attributes.get("src");
    if (
      !sourceAttribute ||
      !/^\.\/[a-z0-9][a-z0-9._/-]*\.js$/i.test(sourceAttribute)
    ) {
      fail(`script must reference a bundled local JavaScript file in ${path}`);
    }
    referencedScripts.push(sourceAttribute);
  }
  return referencedScripts;
}

/** @param {string} directory */
export async function validateArtifactDirectory(directory) {
  const manifest = JSON.parse(
    await readFile(join(directory, "manifest.json"), "utf8"),
  );
  validateManifest(manifest);

  const files = await artifactFiles(directory);
  const sidePanelPath = join(directory, "side-panel.html");
  if (!files.includes(sidePanelPath)) fail("side-panel.html is missing");
  if (!files.includes(join(directory, "side-panel.js"))) {
    fail("side-panel.js is missing");
  }
  if (!files.includes(join(directory, "service-worker.js"))) {
    fail("service-worker.js is missing");
  }
  const sidePanelBundle = await readFile(
    join(directory, "side-panel.js"),
    "utf8",
  );
  if (
    !/node_modules[\\/].*react[\\/]/.test(sidePanelBundle) ||
    !/node_modules[\\/].*react-dom[\\/]/.test(sidePanelBundle)
  ) {
    fail("side-panel.js must bundle React and React DOM");
  }
  const workerBundle = await readFile(
    join(directory, "service-worker.js"),
    "utf8",
  );
  if (
    /node_modules[\\/].*react(?:-dom)?[\\/]|\b(?:document|window|HTMLElement)\b|\.createElement\s*\(/.test(
      workerBundle,
    )
  ) {
    fail("service-worker.js crosses the worker DOM/React owner boundary");
  }
  const foundationPath = join(directory, "foundation.js");
  if (files.includes(foundationPath))
    validateFoundationPublicContract(
      await readFile(foundationPath, "utf8"),
      foundationPath,
    );

  for (const path of files) {
    const extension = extname(path).toLowerCase();
    if (!JavaScriptExtensions.has(extension) && !HtmlExtensions.has(extension))
      continue;
    const source = await readFile(path, "utf8");
    if (JavaScriptExtensions.has(extension)) validateJavaScript(source, path);
    else {
      for (const script of validateHtml(source, path)) {
        const target = join(dirname(path), script.slice(2));
        if (!files.includes(target)) {
          fail(`referenced script is missing: ${script} from ${path}`);
        }
      }
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === new URL(process.argv[1], "file:").href
) {
  await validateArtifactDirectory(process.argv[2] ?? "dist");
}
