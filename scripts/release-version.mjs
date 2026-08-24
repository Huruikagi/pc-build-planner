import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** @param {string} path */
const readJsonVersion = async (path) =>
  JSON.parse(await readFile(path, "utf8")).version;

/**
 * @param {{ rootDirectory?: string }} [options]
 * @returns {Promise<{ version: string, tag: string, zipFileName: string }>}
 */
export async function resolveReleaseVersion({ rootDirectory = "." } = {}) {
  const manifestVersion = await readJsonVersion(
    join(rootDirectory, "manifest.json"),
  );
  const packageVersion = await readJsonVersion(
    join(rootDirectory, "package.json"),
  );

  if (!manifestVersion)
    throw new Error("manifest.json version is missing or empty");

  if (manifestVersion !== packageVersion)
    throw new Error(
      `version mismatch: manifest.json version is "${manifestVersion}" but package.json version is "${packageVersion}"`,
    );

  const version = manifestVersion;
  return {
    version,
    tag: `v${version}`,
    zipFileName: `pc-build-planner-v${version}.zip`,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = await resolveReleaseVersion();
  for (const [key, value] of Object.entries(result))
    process.stdout.write(`${key}=${value}\n`);
}
