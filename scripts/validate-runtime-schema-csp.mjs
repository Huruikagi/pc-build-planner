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
import { dirname, join, resolve } from "node:path";

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

const probeSchema = z.strictObject({
  id: z.string(),
  quantity: z.custom((value) => typeof value === "number"),
});

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
 * Production entries measured by the size report. Mirrors the browser entry
 * points of `scripts/build.mjs`; the CSS entry carries no JavaScript and is
 * therefore excluded.
 */
export const PRODUCTION_ENTRIES = /** @type {const} */ ([
  { name: "build-contract", source: "src/build-contract.ts", format: "esm" },
  { name: "foundation", source: "src/persistence/public.ts", format: "esm" },
  { name: "index", source: "src/index.ts", format: "esm" },
  {
    name: "service-worker",
    source: "src/runtime/service-worker.ts",
    format: "esm",
  },
  { name: "side-panel", source: "src/runtime/side-panel.ts", format: "esm" },
  {
    name: "content-script",
    source: "src/features/product-capture/content-script.ts",
    format: "iife",
  },
]);

// esbuild matches an `onResolve` filter against the import specifier, not the
// resolved file, and the kernel reaches the canonical module as `./zod-mini.js`.
// Filtering on the specifier and then resolving it is what makes the stub apply
// to every importer instead of only to a full path.
const canonicalZodModule = /(?:^|[\\/])zod-mini\.js$/;
const canonicalZodPath = resolve("src/domain/runtime-schema/zod-mini.ts");
const zodStubNamespace = "runtime-schema-zod-stub";

/**
 * Replaces the canonical Zod module with a side-effect-free stub so the
 * baseline is regenerated inside the same run. Anchoring the baseline to a
 * hand-written constant or a previously published artifact would make the
 * delta unreproducible on an arbitrary commit; this keeps both numbers derived
 * from the tree being measured. Gate-only: neither the application build nor
 * the package flow uses this plugin.
 */
const zodStubPlugin = {
  name: "runtime-schema-zod-stub",
  /** @param {import("esbuild").PluginBuild} pluginBuild */
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: canonicalZodModule }, (args) => {
      const from =
        args.importer === "" ? args.resolveDir : dirname(args.importer);
      const resolved = resolve(from, args.path).replace(/\.js$/, ".ts");
      return resolved === canonicalZodPath
        ? { path: "zod-mini-stub", namespace: zodStubNamespace }
        : undefined;
    });
    pluginBuild.onLoad({ filter: /.*/, namespace: zodStubNamespace }, () => ({
      contents: "export const z = {};\n",
      loader: /** @type {const} */ ("js"),
    }));
  },
};

/**
 * Measures an arbitrary source under production conditions. Exported so the
 * stub mechanism itself stays verifiable even while no production entry
 * imports the canonical Zod module yet.
 *
 * @param {string} source
 * @param {boolean} withZodStub
 * @returns {Promise<number>}
 */
export async function measureSourceBytes(source, withZodStub) {
  const built = await build({
    ...productionBuildOptions,
    stdin: {
      contents: source,
      loader: "ts",
      resolveDir: process.cwd(),
      sourcefile: "runtime-schema-measure.ts",
    },
    ...(withZodStub ? { plugins: [zodStubPlugin] } : {}),
  });
  const output = built.outputFiles?.[0];
  if (!output) fail("measured source produced no bundle");
  return output.contents.byteLength;
}

/**
 * @param {(typeof PRODUCTION_ENTRIES)[number]} entry
 * @param {boolean} withZodStub
 * @returns {Promise<number>}
 */
async function measureEntryBytes(entry, withZodStub) {
  const built = await build({
    ...productionBuildOptions,
    entryPoints: { [entry.name]: entry.source },
    format: entry.format,
    metafile: true,
    // `write: false` keeps the measurement in memory; esbuild still needs an
    // outdir to derive output names, but nothing reaches the filesystem.
    outdir: "runtime-schema-gate",
    ...(withZodStub ? { plugins: [zodStubPlugin] } : {}),
  });
  const output = built.outputFiles?.find((file) => file.path.endsWith(".js"));
  if (!output) fail(`production entry ${entry.name} produced no bundle`);
  return output.contents.byteLength;
}

/**
 * @returns {Promise<Array<{ entry: string, baselineBytes: number,
 *   currentBytes: number, deltaBytes: number }>>}
 */
export async function measureProductionBundles() {
  const bundles = [];
  for (const entry of PRODUCTION_ENTRIES) {
    const baselineBytes = await measureEntryBytes(entry, true);
    const currentBytes = await measureEntryBytes(entry, false);
    bundles.push({
      entry: entry.name,
      baselineBytes,
      currentBytes,
      deltaBytes: currentBytes - baselineBytes,
    });
  }
  return bundles;
}

/** Notice asset required in the build staging directory and release archive. */
export const LICENSE_NOTICE_FILE_NAME = "THIRD_PARTY_NOTICES.txt";

const noticeRequiredFragments = [
  /zod 4\.4\.3/,
  /react 19\.2\.8/,
  /react-dom 19\.2\.8/,
  /scheduler 0\.27\.0/,
  /MIT License/,
  /Permission is hereby/,
];

/**
 * Contract shared by build staging and archive verification: the notice must
 * exist, be non-empty, and actually reproduce the runtime dependency's terms.
 *
 * @param {string} directory
 * @returns {Promise<true>}
 */
export async function validateLicenseNoticeAsset(directory) {
  const path = join(directory, LICENSE_NOTICE_FILE_NAME);
  let notice;
  try {
    notice = await readFile(path, "utf8");
  } catch {
    fail(`license notice is missing: ${path}`);
  }
  if (notice.trim() === "") fail(`license notice is empty: ${path}`);
  for (const fragment of noticeRequiredFragments) {
    if (!fragment.test(notice)) {
      fail(`license notice does not cover the runtime dependency: ${path}`);
    }
  }
  return true;
}

/** @param {unknown} value @returns {boolean} */
function isByteCount(value) {
  return Number.isSafeInteger(value) && /** @type {number} */ (value) >= 0;
}

/**
 * Rejects a missing report or a size result that cannot be trusted, so a gate
 * run can never report success without real measurements.
 *
 * @param {unknown} report
 * @returns {asserts report is { dynamicFunctionCalls: number,
 *   bundles: Array<{ entry: string, baselineBytes: number,
 *     currentBytes: number, deltaBytes: number }>,
 *   licenseNoticePresent: true }}
 */
export function assertGateReport(report) {
  if (report === null || typeof report !== "object" || Array.isArray(report)) {
    fail("gate report is missing");
  }
  const candidate = /** @type {Record<string, unknown>} */ (report);
  if (candidate.dynamicFunctionCalls !== 0) {
    fail("gate report must record zero dynamic Function calls");
  }
  if (candidate.licenseNoticePresent !== true) {
    fail("gate report must record the license notice as present");
  }
  const bundles = candidate.bundles;
  if (!Array.isArray(bundles) || bundles.length === 0) {
    fail("gate report must record at least one production bundle size");
  }
  for (const bundle of bundles) {
    if (bundle === null || typeof bundle !== "object") {
      fail("gate report contains an invalid bundle size result");
    }
    const entry = /** @type {Record<string, unknown>} */ (bundle);
    if (typeof entry.entry !== "string" || entry.entry === "") {
      fail("gate report bundle is missing an entry name");
    }
    if (
      !isByteCount(entry.baselineBytes) ||
      !isByteCount(entry.currentBytes) ||
      !Number.isSafeInteger(entry.deltaBytes)
    ) {
      fail(`gate report bundle ${entry.entry} has invalid byte counts`);
    }
    if (
      entry.deltaBytes !==
      /** @type {number} */ (entry.currentBytes) -
        /** @type {number} */ (entry.baselineBytes)
    ) {
      fail(`gate report bundle ${entry.entry} has an inconsistent delta`);
    }
  }
}

/**
 * @param {string} [probeSource]
 * @returns {Promise<{ dynamicFunctionCalls: number,
 *   bundles: Array<{ entry: string, baselineBytes: number,
 *     currentBytes: number, deltaBytes: number }>,
 *   licenseNoticePresent: true }>}
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
  const licenseNoticePresent = await validateLicenseNoticeAsset(".");
  const report = {
    dynamicFunctionCalls: 0,
    bundles: await measureProductionBundles(),
    licenseNoticePresent,
  };
  assertGateReport(report);
  return report;
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
