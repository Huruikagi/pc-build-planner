import { copyFile, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

import { validateArtifactDirectory } from "./validate-artifacts.mjs";

export async function buildUnpackedExtension(outputDirectory = "dist") {
  await rm(outputDirectory, { recursive: true, force: true });
  await build({
    bundle: true,
    entryPoints: {
      "build-contract": "src/build-contract.ts",
      foundation: "src/persistence/public.ts",
      "react-runtime": "src/application-shell/runtime-baseline.tsx",
    },
    define: { "process.env.NODE_ENV": '"production"' },
    format: "esm",
    outdir: outputDirectory,
    platform: "browser",
    sourcemap: false,
    target: "chrome116",
  });
  await copyFile("manifest.json", `${outputDirectory}/manifest.json`);
  await writeFile(`${outputDirectory}/.build-ready`, "unpacked\n", "utf8");
  await validateArtifactDirectory(outputDirectory);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  await buildUnpackedExtension(process.argv[2] ?? "dist");
