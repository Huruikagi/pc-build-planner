import { spawnSync } from "node:child_process";

const tsc = "node_modules/typescript/bin/tsc";

const run = (args) => spawnSync(process.execPath, args, { encoding: "utf8" });

const positive = run([
  tsc,
  "--noEmit",
  "-p",
  "tsconfig.local-data-transaction-public-consumer.json",
]);
if (positive.status !== 0) {
  process.stderr.write(positive.stdout + positive.stderr);
  process.exit(positive.status ?? 1);
}

for (const [config, expected] of [
  [
    "tsconfig.local-data-transaction-missing-error-adapter.negative.json",
    "Property 'errors' is missing",
  ],
  [
    "tsconfig.local-data-transaction-control-confusion.negative.json",
    "PersistentRecoveryControl",
  ],
]) {
  const negative = run([tsc, "--noEmit", "-p", config, "--pretty", "false"]);
  const diagnostic = negative.stdout + negative.stderr;
  if (negative.status === 0 || !diagnostic.includes(expected)) {
    process.stderr.write(
      `unexpected transaction negative fixture result: ${config}\n${diagnostic}`,
    );
    process.exit(1);
  }
}

const runtime = run([
  "--import",
  "tsx",
  "tests/tooling/local-data-transaction-runtime-contract.ts",
]);
if (runtime.status !== 0) {
  process.stderr.write(runtime.stdout + runtime.stderr);
  process.exit(runtime.status ?? 1);
}
