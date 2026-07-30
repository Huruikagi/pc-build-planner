import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

/** @param {string} path */
const normalize = (path) => path.replaceAll("\\", "/");

const workerUiPatterns = [
  /(?:^|\/)src\/application-shell\/side-panel-contributions\.[cm]?[jt]sx?$/,
  /(?:^|\/)src\/features\/[^/]+\/feature-contribution\.[cm]?[jt]sx?$/,
  /(?:^|\/)src\/.*\.[cm]?[jt]sx$/,
  /(?:^|\/)node_modules\/(?:react|react-dom)(?:\/|$)/,
];

const domOrReactSource =
  /(?:from\s*["']react(?:-dom)?(?:\/[^"']*)?["']|require\s*\(\s*["']react(?:-dom)?(?:\/[^"']*)?["']\s*\)|\b(?:document|window)\b|\.createElement\s*\(|\bglobalThis\.(?:HTMLElement|Element|Node|Document|Window)\b|\b(?:instanceof|new)\s+(?:HTMLElement|Element|Node|Document|Window)\b|\b(?:HTMLElement|Element|Node|Document|Window)\s*\.)/;

/** @param {string} source */
const withoutComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * Reject side-panel/UI modules from the service-worker module graph even when
 * esbuild tree-shakes every runtime token from the generated bundle.
 */
/**
 * @param {import("esbuild").Metafile} metafile
 * @param {string} workerOutputPath
 * @param {string} [workingDirectory]
 * @returns {Promise<void>}
 */
export async function validateWorkerModuleGraph(
  metafile,
  workerOutputPath,
  workingDirectory = process.cwd(),
) {
  const expectedOutput = normalize(
    relative(workingDirectory, resolve(workingDirectory, workerOutputPath)),
  );
  const output = Object.entries(metafile.outputs).find(
    ([path]) => normalize(path) === expectedOutput,
  )?.[1];
  if (output === undefined)
    throw new Error(`worker module graph is missing: ${expectedOutput}`);

  const inputs = Object.keys(output.inputs).map(normalize);
  const violations = new Set(
    inputs.filter((path) =>
      workerUiPatterns.some((pattern) => pattern.test(path)),
    ),
  );
  for (const path of inputs) {
    if (!/(?:^|\/)src\/.*\.[cm]?[jt]s$/.test(path)) continue;
    const source = await readFile(resolve(workingDirectory, path), "utf8");
    if (domOrReactSource.test(withoutComments(source))) violations.add(path);
  }
  const orderedViolations = [...violations].sort();
  if (orderedViolations.length > 0) {
    throw new Error(
      `service-worker module graph crosses the side-panel/UI boundary:\n${orderedViolations.join("\n")}`,
    );
  }
}
