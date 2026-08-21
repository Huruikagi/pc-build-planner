import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const positiveFixture = "tests/tooling/local-data-product-consumer-contract.ts";

export const localDataProductConsumerGates = Object.freeze([
  Object.freeze(["pnpm", "typecheck:local-data-product-consumers"]),
  Object.freeze([
    "node",
    "--import",
    "tsx",
    "--test",
    "tests/domain/app-data-error.test.ts",
    "tests/tooling/local-data-product-consumer-validation.test.ts",
  ]),
]);

const violations = Object.freeze([
  Object.freeze({
    code: "candidate-owned-data-error",
    pattern: /\bManagementError\b/u,
  }),
  Object.freeze({
    code: "candidate-owned-data-error-export",
    pattern:
      /import[^;]*\bAppDataError\b[^;]*candidate-management\/public\.js/u,
  }),
  Object.freeze({
    code: "candidate-owned-data-error-mapper",
    pattern:
      /import[^;]*\bmapFoundationError\b[^;]*candidate-management\/public\.js/u,
  }),
  Object.freeze({
    code: "candidate-owned-source-port",
    pattern: /\bCandidateSource(?:Catalog|Mutation)Port\b/u,
  }),
  Object.freeze({
    code: "foundation-error-direct-import",
    pattern: /\bFoundationError\b/u,
  }),
  Object.freeze({
    code: "product-adapter-redefinition",
    pattern: /\bProductLocalDataAdapter\b|product-local-data-adapter/u,
  }),
  Object.freeze({
    code: "package-deep-import",
    pattern: /@pc-build-planner\/local-data\/(?!$)/u,
  }),
  Object.freeze({
    code: "backup-capability-mixing",
    pattern: /\bbackup\.(?:query|mutate|runMaintenance|replaceFromRecovery)\b/u,
  }),
  Object.freeze({
    code: "normal-capability-mixing",
    pattern:
      /\bdata\.(?:assessRecovery|assessReplacement|commit|finalize|findPendingFinalization)\b/u,
  }),
]);

/** @param {string} source */
export const validateProductConsumerSource = (source) =>
  violations
    .filter(({ pattern }) => pattern.test(source))
    .map(({ code }) => code);

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
export async function runLocalDataProductConsumerGates(
  gates,
  runGate = spawnGate,
) {
  const source = await readFile(positiveFixture, "utf8");
  const diagnostics = validateProductConsumerSource(source);
  if (diagnostics.length > 0) {
    console.error(`${positiveFixture}: ${diagnostics.join(", ")}`);
    return 1;
  }
  for (const gate of gates) {
    const [command, ...args] = gate;
    if (command === undefined) return 1;
    const result = runGate(command, args);
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await runLocalDataProductConsumerGates(
    localDataProductConsumerGates,
  );
}
