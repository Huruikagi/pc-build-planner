/**
 * Production feasibility gate for the runtime schema vendor.
 *
 * `z.config({ jitless: true })` is a necessary but not sufficient condition:
 * configuration alone is not evidence. This gate builds a minimal schema probe
 * with the exact production esbuild options used by `scripts/build.mjs`, scans
 * the emitted bundle statically, and then imports it in an isolated Node
 * process where the global `Function` has been replaced by a recording Proxy.
 *
 * Because the Proxy is installed before the bundle is imported and traps both
 * `apply` and `construct`, `const Alias = Function; Alias(...)` and
 * `new Alias(...)` are recorded even though no static pattern can see them.
 * The vendor bundle genuinely contains such an alias probe, so the runtime trap
 * — not the static scan — is what proves it never executes.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";

import { validateManifest } from "./validate-artifacts.mjs";

const runNode = promisify(execFile);

/** @param {string} message @returns {never} */
function fail(message) {
  throw new Error(`Runtime schema gate failed: ${message}`);
}

/**
 * Production build options shared with `scripts/build.mjs`. The probe must not
 * be easier to bundle than the real extension, or the gate proves nothing.
 */
const productionBuildOptions = {
  bundle: true,
  define: { "process.env.NODE_ENV": '"production"' },
  format: /** @type {const} */ ("esm"),
  // The gate reports failures itself; esbuild's own log would leak build noise
  // into the machine-readable output of negative fixtures.
  logLevel: /** @type {const} */ ("silent"),
  platform: /** @type {const} */ ("browser"),
  sourcemap: false,
  target: "chrome116",
  write: false,
};

/**
 * The minimal schema probe: it constructs a schema and parses both an accepted
 * and a rejected value at module evaluation, so importing the bundle exercises
 * the code paths that would need dynamic evaluation.
 */
export const CONFIGURED_PROBE_SOURCE = `import { z } from "./src/domain/runtime-schema/zod-mini.js";

const probeSchema = z.object({ id: z.string(), quantity: z.number() });

const accepted = z.safeParse(probeSchema, { id: "probe", quantity: 1 });
const rejected = z.safeParse(probeSchema, { id: 1, quantity: "one" });

if (!accepted.success) throw new Error("probe schema rejected a valid value");
if (rejected.success) throw new Error("probe schema accepted an invalid value");

export const probed = true;
`;

/** @type {ReadonlyArray<readonly [RegExp, string]>} */
const staticChecks = [
  [/\beval\s*\(/, "eval"],
  [/\bnew\s+Function\s*\(/, "new Function"],
  [/(?<![.\w$])Function\s*\(/, "direct Function call"],
];

/**
 * Runs inside the isolated child process. Installing the Proxy before the
 * dynamic `import()` is what makes alias captures observable: the bundle's
 * top-level code reads `Function` from the global object at evaluation time.
 */
const functionTrapRunner = `const calls = [];
const RealFunction = globalThis.Function;
globalThis.Function = new Proxy(RealFunction, {
  apply(target, thisArgument, argumentList) {
    calls.push("apply");
    return Reflect.apply(target, thisArgument, argumentList);
  },
  construct(target, argumentList, newTarget) {
    calls.push("construct");
    return Reflect.construct(
      target,
      argumentList,
      newTarget === undefined ? target : newTarget,
    );
  },
});
try {
  await import(process.argv[2]);
} finally {
  globalThis.Function = RealFunction;
}
process.stdout.write(JSON.stringify({ dynamicFunctionCalls: calls.length }));
`;

/**
 * Builds one probe source under production conditions, scans it, and runs it
 * behind the `Function` trap.
 *
 * @param {string} source
 * @returns {Promise<{ bytes: number, dynamicFunctionCalls: number,
 *   staticIssues: string[] }>}
 */
export async function inspectProductionProbe(source) {
  const built = await build({
    ...productionBuildOptions,
    stdin: {
      contents: source,
      loader: "ts",
      resolveDir: process.cwd(),
      sourcefile: "runtime-schema-probe.ts",
    },
  });
  const output = built.outputFiles?.[0];
  if (!output) fail("production probe produced no output bundle");

  const staticIssues = staticChecks
    .filter(([pattern]) => pattern.test(output.text))
    .map(([, label]) => label);

  const directory = await mkdtemp(join(tmpdir(), "runtime-schema-gate-"));
  try {
    const bundlePath = join(directory, "probe.mjs");
    const runnerPath = join(directory, "function-trap.mjs");
    await writeFile(bundlePath, output.text, "utf8");
    await writeFile(runnerPath, functionTrapRunner, "utf8");
    const executed = await runNode(process.execPath, [
      runnerPath,
      pathToFileURL(bundlePath).href,
    ]);
    const trapped = JSON.parse(executed.stdout);
    if (typeof trapped?.dynamicFunctionCalls !== "number") {
      fail("function trap did not report a call count");
    }
    return {
      bytes: output.contents.byteLength,
      dynamicFunctionCalls: trapped.dynamicFunctionCalls,
      staticIssues,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * Confirms the extension still declares the Manifest V3 and CSP contract the
 * probe was validated against. A schema bundle that only passes because the
 * CSP was loosened is not evidence of feasibility.
 */
async function assertManifestContractUnchanged() {
  const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
  validateManifest(manifest);
}

/**
 * @param {string} [probeSource]
 * @returns {Promise<{ dynamicFunctionCalls: number }>}
 */
export async function validateRuntimeSchemaFeasibility(
  probeSource = CONFIGURED_PROBE_SOURCE,
) {
  await assertManifestContractUnchanged();
  const inspection = await inspectProductionProbe(probeSource);
  if (inspection.staticIssues.length > 0) {
    fail(
      `production probe contains dynamic evaluation: ${inspection.staticIssues.join(", ")}`,
    );
  }
  if (inspection.dynamicFunctionCalls !== 0) {
    fail(
      `production probe performed ${inspection.dynamicFunctionCalls} dynamic Function call(s)`,
    );
  }
  return { dynamicFunctionCalls: 0 };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const overrideIndex = process.argv.indexOf("--probe-source");
  const probeSource =
    overrideIndex === -1 ? undefined : process.argv[overrideIndex + 1];
  const report = await validateRuntimeSchemaFeasibility(probeSource);
  process.stdout.write(`${JSON.stringify(report)}\n`);
}
