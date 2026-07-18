import { copyFile, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";

import { validateArtifactDirectory } from "./validate-artifacts.mjs";

const outputDirectory = "dist";

await rm(outputDirectory, { recursive: true, force: true });
await build({
  bundle: true,
  entryPoints: ["src/build-contract.ts"],
  format: "esm",
  outdir: outputDirectory,
  platform: "browser",
  sourcemap: true,
  target: "chrome116",
});
await copyFile("manifest.json", `${outputDirectory}/manifest.json`);
await writeFile(`${outputDirectory}/.build-ready`, "unpacked\n", "utf8");
await validateArtifactDirectory(outputDirectory);
