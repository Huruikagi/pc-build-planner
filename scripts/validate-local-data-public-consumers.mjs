import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const localDataPublicConsumerGates = Object.freeze([
  Object.freeze(["pnpm", "clean:local-data"]),
  Object.freeze(["pnpm", "--filter", "@pc-build-planner/local-data", "build"]),
  Object.freeze(["pnpm", "typecheck:local-data-public-consumers"]),
  Object.freeze([
    "node",
    "--import",
    "tsx",
    "tests/tooling/local-data-core-consumer.ts",
  ]),
  Object.freeze([
    "node",
    "--import",
    "tsx",
    "tests/tooling/local-data-chrome-consumer.ts",
  ]),
  Object.freeze([
    "node",
    "--import",
    "tsx",
    "tests/tooling/local-data-backup-consumer.ts",
  ]),
  Object.freeze(["node", "tests/tooling/local-data-undeclared-consumer.mjs"]),
]);

/**
 * @param {readonly (readonly string[])[]} gates
 * @param {(command: string, args: readonly string[]) => { status: number | null }} [spawnGate]
 */
export function runLocalDataPublicConsumerGates(
  gates,
  spawnGate = (command, args) => {
    const pnpmEntry = command === "pnpm" ? process.env.npm_execpath : undefined;
    const pnpmUsesNode =
      pnpmEntry !== undefined && /\.[cm]?js$/u.test(pnpmEntry);
    return spawnSync(
      pnpmUsesNode ? process.execPath : (pnpmEntry ?? command),
      pnpmUsesNode ? [pnpmEntry, ...args] : args,
      { stdio: "inherit" },
    );
  },
) {
  for (const gate of gates) {
    const [command, ...args] = gate;
    if (command === undefined) return 1;
    const result = spawnGate(command, args);
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = runLocalDataPublicConsumerGates(
    localDataPublicConsumerGates,
  );
}
