import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { packageExtension } from "../../scripts/package.mjs";

const validManifest = {
  manifest_version: 3,
  name: "__MSG_extensionName__",
  description: "__MSG_extensionDescription__",
  version: "1.0.0",
  default_locale: "en",
  minimum_chrome_version: "116",
  permissions: [
    "storage",
    "activeTab",
    "scripting",
    "sidePanel",
    "contextMenus",
  ],
  action: {},
  background: { service_worker: "service-worker.js", type: "module" },
  side_panel: { default_path: "side-panel.html" },
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'",
  },
};

const syntheticLocaleCatalog = {
  extensionName: { message: "Synthetic extension" },
  extensionDescription: { message: "A synthetic fixture extension." },
};

async function writeValidBuildOutput(outputDirectory: string) {
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    join(outputDirectory, "manifest.json"),
    JSON.stringify(validManifest),
  );
  for (const locale of ["en", "ja"]) {
    await mkdir(join(outputDirectory, "_locales", locale), {
      recursive: true,
    });
    await writeFile(
      join(outputDirectory, "_locales", locale, "messages.json"),
      JSON.stringify(syntheticLocaleCatalog),
    );
  }
  await writeFile(
    join(outputDirectory, "side-panel.html"),
    '<main id="application-shell"></main><script type="module" src="./side-panel.js"></script>',
  );
  await writeFile(
    join(outputDirectory, "side-panel.js"),
    "/* node_modules/react/cjs/react.production.js */ /* node_modules/react-dom/cjs/react-dom-client.production.js */ export const started=true;",
  );
  await writeFile(
    join(outputDirectory, "service-worker.js"),
    "export const registered=true;",
  );
  await writeFile(join(outputDirectory, ".build-ready"), "unpacked\n");
}

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "package-"));
  await writeFile(
    join(root, "manifest.json"),
    JSON.stringify({ version: "1.0.0" }),
  );
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ version: "1.0.0" }),
  );
  return root;
}

async function listZipEntries(zipPath: string) {
  const archive = await readFile(zipPath);
  const endOfCentralDirectorySize = 22;
  const maximumCommentSize = 0xffff;
  const endOfCentralDirectorySignature = 0x0605_4b50;
  const centralDirectoryHeaderSignature = 0x0201_4b50;

  let endOfCentralDirectoryOffset = -1;
  const earliestOffset = Math.max(
    0,
    archive.length - endOfCentralDirectorySize - maximumCommentSize,
  );

  for (
    let offset = archive.length - endOfCentralDirectorySize;
    offset >= earliestOffset;
    offset -= 1
  ) {
    if (
      archive.readUInt32LE(offset) === endOfCentralDirectorySignature &&
      offset + endOfCentralDirectorySize + archive.readUInt16LE(offset + 20) ===
        archive.length
    ) {
      endOfCentralDirectoryOffset = offset;
      break;
    }
  }

  if (endOfCentralDirectoryOffset < 0) {
    throw new Error("Invalid ZIP: end-of-central-directory record not found");
  }

  const diskNumber = archive.readUInt16LE(endOfCentralDirectoryOffset + 4);
  const centralDirectoryDisk = archive.readUInt16LE(
    endOfCentralDirectoryOffset + 6,
  );
  const entriesOnDisk = archive.readUInt16LE(endOfCentralDirectoryOffset + 8);
  const entryCount = archive.readUInt16LE(endOfCentralDirectoryOffset + 10);
  const centralDirectorySize = archive.readUInt32LE(
    endOfCentralDirectoryOffset + 12,
  );
  const centralDirectoryOffset = archive.readUInt32LE(
    endOfCentralDirectoryOffset + 16,
  );

  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    entriesOnDisk !== entryCount
  ) {
    throw new Error("Invalid ZIP: multi-disk archives are not supported");
  }
  if (
    entryCount === 0xffff ||
    centralDirectorySize === 0xffff_ffff ||
    centralDirectoryOffset === 0xffff_ffff
  ) {
    throw new Error("Invalid ZIP: ZIP64 archives are not supported");
  }

  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  if (
    centralDirectoryOffset > archive.length ||
    centralDirectoryEnd !== endOfCentralDirectoryOffset
  ) {
    throw new Error("Invalid ZIP: central directory is out of bounds");
  }

  const entries: string[] = [];
  let cursor = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    const fixedHeaderSize = 46;
    if (
      cursor + fixedHeaderSize > centralDirectoryEnd ||
      archive.readUInt32LE(cursor) !== centralDirectoryHeaderSignature
    ) {
      throw new Error(
        `Invalid ZIP: malformed central directory entry ${index}`,
      );
    }

    const fileNameLength = archive.readUInt16LE(cursor + 28);
    const extraFieldLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const entryEnd =
      cursor +
      fixedHeaderSize +
      fileNameLength +
      extraFieldLength +
      commentLength;
    if (fileNameLength === 0 || entryEnd > centralDirectoryEnd) {
      throw new Error(
        `Invalid ZIP: malformed central directory entry ${index}`,
      );
    }

    entries.push(
      archive.toString(
        "utf8",
        cursor + fixedHeaderSize,
        cursor + fixedHeaderSize + fileNameLength,
      ),
    );
    cursor = entryEnd;
  }

  if (cursor !== centralDirectoryEnd) {
    throw new Error(
      "Invalid ZIP: central directory size does not match entries",
    );
  }

  return entries;
}

test("配布対象のみをステージングしdotで始まるファイルを除外する", async () => {
  const root = await workspace();
  const outputDirectory = join(root, "dist");
  await writeValidBuildOutput(outputDirectory);

  const result = await packageExtension({
    outputDirectory,
    releaseDirectory: join(root, "release"),
    rootDirectory: root,
  });

  assert.ok(
    !result.includedFiles.some((path) =>
      path.split(/[\\/]/).some((part) => part.startsWith(".")),
    ),
  );
  const entries = await listZipEntries(result.zipPath);
  assert.ok(
    !entries.some((entry) =>
      entry.split("/").some((part) => part.startsWith(".")),
    ),
  );
});

test("展開結果の最上位にmanifestが来る構造にする", async () => {
  const root = await workspace();
  const outputDirectory = join(root, "dist");
  await writeValidBuildOutput(outputDirectory);

  const result = await packageExtension({
    outputDirectory,
    releaseDirectory: join(root, "release"),
    rootDirectory: root,
  });

  const entries = await listZipEntries(result.zipPath);
  assert.ok(entries.includes("manifest.json"), entries.join(","));
});

test("zipファイル名はバージョンから導出された名前になる", async () => {
  const root = await workspace();
  const outputDirectory = join(root, "dist");
  await writeValidBuildOutput(outputDirectory);

  const result = await packageExtension({
    outputDirectory,
    releaseDirectory: join(root, "release"),
    rootDirectory: root,
  });

  assert.match(result.zipPath, /pc-build-planner-v1\.0\.0\.zip$/);
  await access(result.zipPath);
});

test("成果物検査に失敗した場合はzipを生成しない", async () => {
  const root = await workspace();
  const outputDirectory = join(root, "dist");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    join(outputDirectory, "manifest.json"),
    JSON.stringify(validManifest),
  );
  // side-panel.html / side-panel.js / service-worker.js are missing on purpose.

  await assert.rejects(
    packageExtension({
      outputDirectory,
      releaseDirectory: join(root, "release"),
      rootDirectory: root,
    }),
  );
  await assert.rejects(
    access(join(root, "release", "pc-build-planner-v1.0.0.zip")),
  );
});

test("再実行時にステージングと既存zipの残骸を持ち越さない", async () => {
  const root = await workspace();
  const outputDirectory = join(root, "dist");
  await writeValidBuildOutput(outputDirectory);
  const releaseDirectory = join(root, "release");

  await packageExtension({
    outputDirectory,
    releaseDirectory,
    rootDirectory: root,
  });

  const stalePath = join(releaseDirectory, "package", "stale-leftover.txt");
  await mkdir(join(releaseDirectory, "package"), { recursive: true });
  await writeFile(stalePath, "leftover");

  const result = await packageExtension({
    outputDirectory,
    releaseDirectory,
    rootDirectory: root,
  });

  await assert.rejects(access(stalePath));
  const entries = await listZipEntries(result.zipPath);
  assert.ok(!entries.includes("stale-leftover.txt"));
});

test("破損したzipは明示的な検証エラーにする", async () => {
  const root = await workspace();
  const zipPath = join(root, "malformed.zip");
  await writeFile(zipPath, "not a zip archive");

  await assert.rejects(listZipEntries(zipPath), /Invalid ZIP/);
});

test("配布用アーカイブは両ロケールの資産を含む(BuildLocaleCopy)", async () => {
  const root = await workspace();
  const outputDirectory = join(root, "dist");
  await writeValidBuildOutput(outputDirectory);

  const result = await packageExtension({
    outputDirectory,
    releaseDirectory: join(root, "release"),
    rootDirectory: root,
  });

  const entries = await listZipEntries(result.zipPath);
  for (const locale of ["en", "ja"]) {
    const relativePath = join("_locales", locale, "messages.json");
    assert.ok(
      result.includedFiles.includes(relativePath),
      `expected ${relativePath} in includedFiles: ${result.includedFiles.join(",")}`,
    );
    assert.ok(
      entries.includes(relativePath),
      `expected ${relativePath} in zip entries: ${entries.join(",")}`,
    );
  }
});
