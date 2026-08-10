import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

/**
 * Bundles a browser harness entry point and returns a page URL for it, so a
 * spec can drive production modules in a real browser without an extension.
 */
export async function buildHarnessPage(
  entryPoint: string,
  prefix: string,
): Promise<string> {
  const output = await mkdtemp(path.join(tmpdir(), `${prefix}-`));
  const bundle = path.join(output, "harness.js");
  await build({
    bundle: true,
    entryPoints: [entryPoint],
    format: "iife",
    outfile: bundle,
    platform: "browser",
    target: "chrome116",
  });
  const html = path.join(output, "index.html");
  await writeFile(
    html,
    '<!doctype html><div id="root"></div><script src="./harness.js"></script>',
    "utf8",
  );
  return pathToFileURL(html).href;
}
