import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const localDataProductContractGates = Object.freeze([
  Object.freeze([
    "node",
    "--import",
    "tsx",
    "--test",
    "tests/persistence/*.test.ts",
  ]),
]);

/** @param {string} command @param {readonly string[]} args */
const spawnGate = (command, args) =>
  spawnSync(command === "node" ? process.execPath : command, args, {
    stdio: "inherit",
  });

/**
 * @param {readonly (readonly string[])[]} gates
 * @param {(command: string, args: readonly string[]) => { status: number | null }} [runGate]
 */
export function runLocalDataProductContractGates(gates, runGate = spawnGate) {
  for (const gate of gates) {
    const [command, ...args] = gate;
    if (command === undefined) return 1;
    const result = runGate(command, args);
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = runLocalDataProductContractGates(
    localDataProductContractGates,
  );
}
