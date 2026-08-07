import { copyFile, cp, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

import { validateArtifactDirectory } from "./validate-artifacts.mjs";
import {
  LICENSE_NOTICE_FILE_NAME,
  validateRuntimeSchemaFeasibility,
} from "./validate-runtime-schema-csp.mjs";
import { validateWorkerModuleGraph } from "./validate-worker-module-graph.mjs";

export async function buildUnpackedExtension(outputDirectory = "dist") {
  await rm(outputDirectory, { recursive: true, force: true });
  const runtimeSchemaGateReport = await validateRuntimeSchemaFeasibility();
  const browserBuild = await build({
    bundle: true,
    entryPoints: {
      "build-contract": "src/build-contract.ts",
      foundation: "src/persistence/public.ts",
      index: "src/index.ts",
      "service-worker": "src/runtime/service-worker.ts",
      "side-panel": "src/runtime/side-panel.ts",
      // Styles are a CSS entry so the Node test runtime never imports CSS.
      styles: "src/application-shell/side-panel.css",
    },
    define: { "process.env.NODE_ENV": '"production"' },
    format: "esm",
    outdir: outputDirectory,
    platform: "browser",
    sourcemap: false,
    target: "chrome116",
    metafile: true,
  });
  await validateWorkerModuleGraph(
    browserBuild.metafile,
    `${outputDirectory}/service-worker.js`,
  );
  // `chrome.scripting.executeScript({ files: [...] })` injects a classic
  // (non-module) script, so this entry is built separately as an IIFE.
  await build({
    bundle: true,
    entryPoints: {
      "content-script": "src/features/product-capture/content-script.ts",
    },
    define: { "process.env.NODE_ENV": '"production"' },
    format: "iife",
    outdir: outputDirectory,
    platform: "browser",
    sourcemap: false,
    target: "chrome116",
  });
  await copyFile("manifest.json", `${outputDirectory}/manifest.json`);
  await copyFile("side-panel.html", `${outputDirectory}/side-panel.html`);
  await copyFile(
    LICENSE_NOTICE_FILE_NAME,
    `${outputDirectory}/${LICENSE_NOTICE_FILE_NAME}`,
  );
  await cp("_locales", `${outputDirectory}/_locales`, { recursive: true });
  await writeFile(
    `${outputDirectory}/runtime-schema-gate-report.json`,
    `${JSON.stringify(runtimeSchemaGateReport)}\n`,
    "utf8",
  );
  await writeFile(`${outputDirectory}/.build-ready`, "unpacked\n", "utf8");
  await validateArtifactDirectory(outputDirectory);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  await buildUnpackedExtension(process.argv[2] ?? "dist");
