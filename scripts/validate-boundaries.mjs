import { readdir, readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";

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
      tokens[end]?.kind === SyntaxKind.DotToken &&
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

/** @param {string} value */
const canonicalApiPath = (value) =>
  value.startsWith("globalThis.") ? value.slice("globalThis.".length) : value;

/** @param {readonly SourceFile[]} sources @returns {BoundaryViolation[]} */
export const findBoundaryViolations = (sources) =>
  sources.flatMap(({ path, source }) => {
    const normalizedPath = path.replaceAll("\\", "/");
    const isApplicationShell =
      normalizedPath.includes("/application-shell/") ||
      normalizedPath.includes("/runtime/") ||
      /\/src\/index\.(?:ts|js)$/.test(`/${normalizedPath}`);
    const isDownstreamFeature = normalizedPath.includes("/features/");
    const tokens = tokenize(source);
    const aliases = new Map();
    const rules = new Set();
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token === undefined) continue;
      const string = foldedString(tokens, index);
      if (string?.value === LOCK_NAME) rules.add("no-root-lock-bypass");
      if (
        token?.kind === SyntaxKind.StringLiteral &&
        isForbiddenImport(token.value) &&
        tokens
          .slice(Math.max(0, index - 4), index)
          .some(({ kind }) =>
            [SyntaxKind.ImportKeyword, SyntaxKind.FromKeyword].includes(kind),
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
            [SyntaxKind.ImportKeyword, SyntaxKind.FromKeyword].includes(kind),
          )
      )
        rules.add("application-shell-feature-public-import-only");
      const pathValue = memberPath(tokens, index, aliases);
      if (
        pathValue !== undefined &&
        canonicalApiPath(pathValue.value).startsWith("chrome.storage")
      )
        rules.add(
          isApplicationShell
            ? "application-shell-no-direct-storage"
            : "no-direct-storage",
        );
      if (
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
    if (
      isApplicationShell &&
      /\b(?:interface|type|class)\s+MaintenanceSnapshotSource\b/.test(source)
    )
      rules.add("application-shell-no-maintenance-contract-redefinition");
    if (isApplicationShell && /\bFoundationRuntimePlatform\b/.test(source))
      rules.add("application-shell-no-foundation-platform-injection");
    if (
      isApplicationShell &&
      /\binitializeFoundationRuntimeContribution\b(?!FromPlatform)/.test(source)
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

// StorageAccessGuard (3.2, 3.4): `chrome.storage` reachability is confined to
// the local data foundation's adapter and the display-language preference
// port. In the pre-build source tree that means these exact two files; in the
// bundled `dist/` output (where esbuild merges many source files into one
// bundle per entry point) that means only the two bundles that legitimately
// contain them.
const ALLOWED_STORAGE_ACCESS_SOURCE_PATTERNS = [
  /(?:^|\/)persistence\/chrome-storage-adapter\.ts$/,
  /(?:^|\/)ui-language\/preference-store\.ts$/,
  /(?:^|\/)runtime\/transient-activation-store\.ts$/,
];
const ALLOWED_STORAGE_ACCESS_BUNDLE_BASENAMES = new Set([
  "foundation.js",
  "side-panel.js",
  "service-worker.js",
]);

/** @param {string} path */
const isAllowedStorageAccessPath = (path) => {
  const normalized = path.replaceAll("\\", "/");
  if (
    ALLOWED_STORAGE_ACCESS_SOURCE_PATTERNS.some((pattern) =>
      pattern.test(normalized),
    )
  )
    return true;
  const basename = normalized.split("/").pop() ?? "";
  return ALLOWED_STORAGE_ACCESS_BUNDLE_BASENAMES.has(basename);
};

/** @param {readonly SourceFile[]} sources @returns {BoundaryViolation[]} */
export const findStorageAccessViolations = (sources) =>
  sources.flatMap(({ path, source }) => {
    if (isAllowedStorageAccessPath(path)) return [];
    const tokens = tokenize(source);
    const aliases = new Map();
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token === undefined) continue;
      const pathValue = memberPath(tokens, index, aliases);
      if (
        pathValue !== undefined &&
        canonicalApiPath(pathValue.value).startsWith("chrome.storage")
      )
        return [{ path, rule: "no-direct-storage-access" }];
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
