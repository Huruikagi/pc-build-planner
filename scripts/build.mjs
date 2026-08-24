/**
 * MV3 の未パッケージ拡張を `dist/` へ生成する。
 *
 * `salvage/build/build.mjs` を出発点に、検証ゲート群 (validate-artifacts /
 * validate-runtime-schema-csp / validate-worker-module-graph) を落とした形。
 * ゲートは必要が実証されてから足す (`docs/reverse/changes.md` C-5)。
 */
import { copyFile, cp, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build, context } from "esbuild";

/** @type {Partial<import("esbuild").BuildOptions>} */
const SHARED = {
  bundle: true,
  define: { "process.env.NODE_ENV": '"production"' },
  platform: "browser",
  sourcemap: false,
  target: "chrome116",
};

/** side panel と service worker。CSP 上どちらも ESM で読み込む。 */
const extensionEntryPoints = {
  "service-worker": "src/service-worker.ts",
  "side-panel": "src/side-panel.tsx",
  styles: "src/ui.css",
};

export async function buildExtension(outputDirectory = "dist") {
  await rm(outputDirectory, { recursive: true, force: true });
  await build({
    ...SHARED,
    entryPoints: extensionEntryPoints,
    format: "esm",
    outdir: outputDirectory,
  });
  /**
   * `chrome.scripting.executeScript({ files })` は classic script として
   * 注入するので、content script だけ IIFE で別ビルドする。
   */
  await build({
    ...SHARED,
    entryPoints: { "content-script": "src/capture/content-script.ts" },
    format: "iife",
    outdir: outputDirectory,
  });
  await copyFile("manifest.json", `${outputDirectory}/manifest.json`);
  await copyFile("side-panel.html", `${outputDirectory}/side-panel.html`);
  await copyFile(
    "THIRD_PARTY_NOTICES.txt",
    `${outputDirectory}/THIRD_PARTY_NOTICES.txt`,
  );
  await cp("_locales", `${outputDirectory}/_locales`, { recursive: true });
}

/**
 * 開発ハーネスを配信する。実アプリを同じ composition で起動し、保存先と
 * 文言解決だけを差し替える (`src/dev.tsx`)。
 */
export async function serveDev(port = 5173) {
  const ctx = await context({
    ...SHARED,
    define: { "process.env.NODE_ENV": '"development"' },
    entryPoints: { dev: "src/dev.tsx", styles: "src/ui.css" },
    format: "esm",
    outdir: "dist-dev",
    sourcemap: true,
  });
  await ctx.watch();
  await copyFile("dev.html", "dist-dev/index.html");
  const server = await ctx.serve({ port, servedir: "dist-dev" });
  console.log(`dev harness: http://localhost:${server.port}/`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (process.argv.includes("--dev")) await serveDev();
  else await buildExtension(process.argv[2] ?? "dist");
}
