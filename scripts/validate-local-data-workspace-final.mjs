import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const localDataPackageGates = Object.freeze([
  Object.freeze([
    "pnpm",
    "--filter",
    "@pc-build-planner/local-data",
    "validate",
  ]),
  Object.freeze(["pnpm", "validate:local-data-public-consumers"]),
  Object.freeze(["pnpm", "validate:local-data-read-only-app-contract"]),
  Object.freeze(["pnpm", "validate:local-data-boundaries"]),
  Object.freeze(["pnpm", "build"]),
]);

export const localDataProductOwnerGates = Object.freeze([
  Object.freeze(["pnpm", "validate:local-data-product-contract"]),
  Object.freeze(["pnpm", "validate:local-data-product-consumers"]),
]);

export const localDataWorkspaceGates = Object.freeze([
  ...localDataPackageGates,
  ...localDataProductOwnerGates,
]);

export const localDataPackageImpactGates = localDataWorkspaceGates;

const productOwnerPath =
  /^(?:src\/(?:application-shell|domain|features|persistence|project-context|ui-language)\/|tests\/(?:application-shell|domain|features|persistence|project-context|ui-language)\/)/u;

const packagePublicContractPath =
  /^packages\/local-data\/(?:src\/|package\.json$)/u;

/** @param {string} command @param {readonly string[]} args */
const spawnGate = (command, args) => {
  const pnpmEntry = command === "pnpm" ? process.env.npm_execpath : undefined;
  const pnpmUsesNode = pnpmEntry !== undefined && /\.[cm]?js$/u.test(pnpmEntry);
  return spawnSync(
    pnpmUsesNode ? process.execPath : (pnpmEntry ?? command),
    pnpmUsesNode ? [pnpmEntry, ...args] : args,
    { stdio: "inherit" },
  );
};

/**
 * @param {readonly (readonly string[])[]} gates
 * @param {(command: string, args: readonly string[]) => { status: number | null }} [runGate]
 */
export function runLocalDataWorkspaceGates(gates, runGate = spawnGate) {
  for (const gate of gates) {
    const [command, ...args] = gate;
    if (command === undefined) return 1;
    const result = runGate(command, args);
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

/**
 * @param {readonly string[]} changedPaths
 * @param {(command: string, args: readonly string[]) => { status: number | null }} [runGate]
 */
export function runLocalDataChangedValidation(
  changedPaths,
  runGate = spawnGate,
) {
  const productOnly =
    changedPaths.length > 0 &&
    changedPaths.every((path) =>
      productOwnerPath.test(path.replaceAll("\\", "/")),
    );
  const packagePublicImpact = changedPaths.some((path) =>
    packagePublicContractPath.test(path.replaceAll("\\", "/")),
  );
  return runLocalDataWorkspaceGates(
    productOnly
      ? localDataProductOwnerGates
      : packagePublicImpact
        ? localDataPackageImpactGates
        : localDataWorkspaceGates,
    runGate,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  process.exitCode =
    args[0] === "--changed"
      ? runLocalDataChangedValidation(args.slice(1))
      : runLocalDataWorkspaceGates(localDataWorkspaceGates);
}
