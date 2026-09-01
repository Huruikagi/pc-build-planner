/**
 * 配布用 zip を release/ へ生成する。
 *
 * v0.4.0 の `scripts/package.mjs` を出発点に、削除した検証ゲート
 * (validate-artifacts.mjs) への依存を落とした形。
 */
import { spawn } from "node:child_process";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { resolveReleaseVersion } from "./release-version.mjs";

/** @param {string} directory @returns {Promise<string[]>} */
async function listFilesRecursive(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFilesRecursive(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

/** @param {string} command @param {string[]} args @param {{ cwd?: string }} [options] */
function runCommand(command, args, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { ...options, stdio: "ignore" });
    child.on("error", (error) => {
      reject(new Error(`failed to start ${command}: ${error.message}`));
    });
    child.on("close", (code) => {
      if (code === 0) resolvePromise(undefined);
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

/** @param {string} stagingDirectory @param {string} zipPath */
async function createZipArchive(stagingDirectory, zipPath) {
  const absoluteStaging = resolve(stagingDirectory);
  const absoluteZip = resolve(zipPath);
  await mkdir(dirname(absoluteZip), { recursive: true });

  if (process.platform === "win32") {
    /**
     * Windows PowerShell 5.1 (.NET Framework) はエントリ名を
     * `_locales\en\messages.json` のようにバックスラッシュで書く。
     * ZIP の仕様はスラッシュなので Chrome が `_locales` を読めない。
     * .NET Core を使う pwsh は正しく書くため、そちらを優先する。
     */
    const script = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${absoluteStaging}', '${absoluteZip}', [System.IO.Compression.CompressionLevel]::Optimal, $false)`;
    const args = ["-NoProfile", "-NonInteractive", "-Command", script];
    try {
      await runCommand("pwsh", args);
    } catch {
      throw new Error(
        "pwsh (PowerShell 7+) is required to package on Windows: Windows PowerShell 5.1 writes backslash separators that Chrome cannot read",
      );
    }
    return;
  }

  await runCommand("zip", ["-r", absoluteZip, "."], { cwd: absoluteStaging });
}

/**
 * @param {{ outputDirectory?: string, releaseDirectory?: string, rootDirectory?: string }} [options]
 * @returns {Promise<{ zipPath: string, includedFiles: string[] }>}
 */
export async function packageExtension({
  outputDirectory = "dist",
  releaseDirectory = "release",
  rootDirectory,
} = {}) {
  const { zipFileName } = await resolveReleaseVersion(
    rootDirectory === undefined ? undefined : { rootDirectory },
  );
  const stagingDirectory = join(releaseDirectory, "package");
  const zipPath = join(releaseDirectory, zipFileName);

  await rm(stagingDirectory, { recursive: true, force: true });
  await rm(zipPath, { force: true });

  await mkdir(stagingDirectory, { recursive: true });
  try {
    await cp(outputDirectory, stagingDirectory, {
      recursive: true,
      filter: (source) => !basename(source).startsWith("."),
    });

    const includedFiles = (await listFilesRecursive(stagingDirectory)).map(
      (path) => relative(stagingDirectory, path),
    );

    await createZipArchive(stagingDirectory, zipPath);

    return { zipPath, includedFiles };
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true });
    await rm(zipPath, { force: true });
    throw error;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  await packageExtension();
