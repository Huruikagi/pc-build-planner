import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";

export const localDataReadOnlyAppContractGates = Object.freeze([
  Object.freeze(["pnpm", "clean:local-data"]),
  Object.freeze(["pnpm", "--filter", "@pc-build-planner/local-data", "build"]),
  Object.freeze(["pnpm", "typecheck:local-data-read-only-app-contract"]),
]);

/** @typedef {{ status: number | null, stdout?: unknown, stderr?: unknown }} GateResult */

/**
 * @param {string} command
 * @param {readonly string[]} args
 * @param {{ stdio?: "inherit" }} [options]
 * @returns {GateResult}
 */
const spawnGate = (command, args, options = {}) => {
  const pnpmEntry = command === "pnpm" ? process.env.npm_execpath : undefined;
  const pnpmUsesNode = pnpmEntry !== undefined && /\.[cm]?js$/u.test(pnpmEntry);
  return spawnSync(
    pnpmUsesNode ? process.execPath : (pnpmEntry ?? command),
    pnpmUsesNode ? [pnpmEntry, ...args] : args,
    { encoding: "utf8", ...options },
  );
};

export const forbiddenBackupCapabilities = Object.freeze([
  "query",
  "mutate",
  "execute",
  "readRoot",
  "writeRoot",
  "storage",
  "lock",
  "fence",
]);

export const productDeclarationMarkers = Object.freeze([
  "LocalDataRoot",
  "FoundationError",
  "MaintenanceState",
  "RootOperation",
  "BackupArtifact",
  "BackupDataV1",
  "CurrentBackupEnvelope",
  "RestoreInput",
  "RestorePreview",
  "RestoreSummary",
  "src/domain/public.js",
  "src/features/backup-restore/contracts.js",
  "src/persistence/public.js",
]);

const negativeFixturePath =
  "tests/tooling/local-data-read-only-app-contract-negative.mts";

/**
 * @param {GateResult} result
 * @param {string} fixture
 * @param {readonly string[]} capabilities
 */
export function validateNegativeCapabilityDiagnostics(
  result,
  fixture,
  capabilities = forbiddenBackupCapabilities,
) {
  if (result.status === 0) return false;
  const expectedLocations = new Map();
  for (const [index, line] of fixture.split(/\r?\n/u).entries()) {
    const match = /^backup\.([A-Za-z][A-Za-z0-9]*);$/u.exec(line.trim());
    if (match?.[1] !== undefined) {
      expectedLocations.set(match[1], {
        line: index + 1,
        column: line.indexOf(match[1]) + 1,
      });
    }
  }

  const diagnostics = `${String(result.stdout ?? "")}\n${String(result.stderr ?? "")}`;
  const rejected = new Set();
  const diagnosticPattern =
    /^(.+?)\((\d+),(\d+)\): error TS2339: Property '([^']+)' does not exist on type .+$/u;
  const diagnosticLines = diagnostics
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0);
  if (diagnosticLines.length !== capabilities.length) return false;
  for (const diagnostic of diagnosticLines) {
    const match = diagnosticPattern.exec(diagnostic);
    if (match === null) return false;
    const [, path, line, , property] = match;
    const location =
      property === undefined ? undefined : expectedLocations.get(property);
    if (
      !path?.replaceAll("\\", "/").endsWith(negativeFixturePath) ||
      property === undefined ||
      location === undefined ||
      Number(line) !== location.line ||
      Number(match[3]) !== location.column ||
      rejected.has(property)
    ) {
      return false;
    }
    rejected.add(property);
  }
  return (
    rejected.size === capabilities.length &&
    capabilities.every((capability) => rejected.has(capability))
  );
}

/** @param {string} declaration */
export function findProductDeclarationLeak(declaration) {
  const normalized = declaration.replaceAll("\\", "/");
  return productDeclarationMarkers.find((marker) => {
    if (marker.includes("/")) return normalized.includes(marker);
    const escaped = marker.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const importedNames = normalized
      .split(/\r?\n/u)
      .filter((line) => /^(?:import|export)\b.+\bfrom\s+["']/u.test(line));
    return importedNames.some((line) =>
      new RegExp(`(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`, "u").test(
        line,
      ),
    );
  });
}

/**
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
const declarationFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  /** @type {string[][]} */
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return declarationFiles(path);
      return extname(entry.name) === ".ts" && entry.name.endsWith(".d.ts")
        ? [path]
        : [];
    }),
  );
  return nested.flat();
};

/**
 * @param {readonly (readonly string[])[]} gates
 * @param {(command: string, args: readonly string[]) => Promise<GateResult>} [runGate]
 */
export async function runLocalDataReadOnlyAppContractGates(
  gates,
  runGate = async (command, args) =>
    spawnGate(command, args, { stdio: "inherit" }),
  options = {},
) {
  for (const gate of gates) {
    const [command, ...args] = gate;
    if (command === undefined) return 1;
    const result = await runGate(command, args);
    if (result.status !== 0) return result.status ?? 1;
  }

  const runNegative =
    options.runNegative ?? ((command, args) => spawnGate(command, args));
  const negative = await runNegative("pnpm", [
    "exec",
    "tsc",
    "--noEmit",
    "--pretty",
    "false",
    "-p",
    "tsconfig.local-data-read-only-app-contract-negative.json",
  ]);
  const fixture = await readFile(negativeFixturePath, "utf8");
  if (!validateNegativeCapabilityDiagnostics(negative, fixture)) {
    process.stderr.write(
      "read-only backup negative fixture did not reject every forbidden capability\n",
    );
    process.stderr.write(
      `${String(negative.stdout ?? "")}\n${String(negative.stderr ?? "")}`,
    );
    return 1;
  }

  for (const file of await declarationFiles("packages/local-data/dist")) {
    const declaration = await readFile(file, "utf8");
    const leak = findProductDeclarationLeak(declaration);
    if (leak !== undefined) {
      process.stderr.write(`product-owned type ${leak} leaked into ${file}\n`);
      return 1;
    }
  }

  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await runLocalDataReadOnlyAppContractGates(
    localDataReadOnlyAppContractGates,
  );
}
