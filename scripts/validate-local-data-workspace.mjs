import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const boundaryGate = Object.freeze(["pnpm", "validate:local-data-boundaries"]);

export const localDataValidationRoutes = Object.freeze({
  core: Object.freeze([
    Object.freeze([
      "pnpm",
      "--filter",
      "@pc-build-planner/local-data",
      "build",
    ]),
    Object.freeze([
      "pnpm",
      "--filter",
      "@pc-build-planner/local-data",
      "typecheck",
    ]),
    Object.freeze([
      "pnpm",
      "--filter",
      "@pc-build-planner/local-data",
      "test:core",
    ]),
    Object.freeze([
      "node",
      "--import",
      "tsx",
      "tests/tooling/local-data-core-consumer.ts",
    ]),
    boundaryGate,
  ]),
  chrome: Object.freeze([
    Object.freeze([
      "pnpm",
      "--filter",
      "@pc-build-planner/local-data",
      "test:chrome",
    ]),
    Object.freeze([
      "node",
      "--import",
      "tsx",
      "tests/tooling/local-data-chrome-consumer.ts",
    ]),
    boundaryGate,
  ]),
  backup: Object.freeze([
    Object.freeze([
      "pnpm",
      "--filter",
      "@pc-build-planner/local-data",
      "test:backup",
    ]),
    Object.freeze([
      "node",
      "--import",
      "tsx",
      "tests/tooling/local-data-backup-consumer.ts",
    ]),
    boundaryGate,
  ]),
  contracts: Object.freeze([
    Object.freeze(["pnpm", "validate:local-data-public-consumers"]),
    Object.freeze(["pnpm", "validate:local-data-read-only-app-contract"]),
    boundaryGate,
  ]),
});

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
 * @param {keyof typeof localDataValidationRoutes} route
 * @param {(command: string, args: readonly string[]) => { status: number | null }} [runGate]
 */
export function runLocalDataValidationRoute(route, runGate = spawnGate) {
  const gates = localDataValidationRoutes[route];
  if (gates === undefined) return 2;
  for (const [index, gate] of gates.entries()) {
    const [command, ...args] = gate;
    if (command === undefined) return 2;
    const result = runGate(command, args);
    if (result.status !== 0) {
      process.stderr.write(
        `local-data-validation ${route} gate-${index + 1} exit-${result.status ?? 1}\n`,
      );
      return result.status ?? 1;
    }
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const route = process.argv[2];
  if (route === undefined || !(route in localDataValidationRoutes)) {
    process.stderr.write("local-data-validation invalid-route exit-2\n");
    process.exitCode = 2;
  } else {
    process.exitCode = runLocalDataValidationRoute(
      /** @type {keyof typeof localDataValidationRoutes} */ (route),
    );
  }
}
