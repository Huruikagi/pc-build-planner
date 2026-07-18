import { rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";

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
await writeFile(`${outputDirectory}/.build-ready`, "unpacked\n", "utf8");
