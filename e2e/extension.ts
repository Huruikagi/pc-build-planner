/**
 * 未パッケージ拡張を実ブラウザへ読み込むためのヘルパ。
 *
 * 表示言語はブラウザの UI 言語で決まるので、ロケールの検証は
 * `--lang` を変えたコンテキストを別々に起動して行う
 * (`docs/reverse/features.md` 7.4)。アプリ内トグルは存在しない。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  type BrowserContext,
  chromium,
  expect,
  type Page,
  type Worker,
} from "@playwright/test";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const EXTENSION_PATH = path.join(repositoryRoot, "dist");

/**
 * 検証するロケール。
 *
 * - `lang`     : ブラウザ起動時の UI 言語
 * - `catalog`  : 実際に引かれる `_locales/<dir>`。文言そのもので証明する
 */
export const LOCALES = [
  { lang: "ja", catalog: "ja" },
  { lang: "en-US", catalog: "en" },
] as const;

export interface LoadedExtension {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly worker: Worker;
  /** boot から現在までに拾った console error と page error。 */
  readonly diagnostics: readonly string[];
  readStoredRoot(): Promise<StoredRoot | undefined>;
  close(): Promise<void>;
}

export interface StoredRoot {
  readonly schemaVersion: number;
  readonly revision: number;
  readonly selectedProjectId: string | null;
  readonly projects: readonly { readonly id: string; readonly name: string }[];
  readonly candidateParts: readonly {
    readonly id: string;
    readonly name: string;
    readonly category: string;
    readonly attributes: Readonly<
      Record<string, { readonly confirmed?: unknown }>
    >;
  }[];
}

export const loadExtension = async (
  lang: string,
  profileDirectory: string,
): Promise<LoadedExtension> => {
  const context = await chromium.launchPersistentContext(profileDirectory, {
    channel: "chromium",
    viewport: { width: 400, height: 900 },
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      `--lang=${lang}`,
    ],
  });

  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(worker.url()).host;
  expect(extensionId).toMatch(/^[a-p]{32}$/);

  const diagnostics: string[] = [];
  const page = await context.newPage();
  page.on("pageerror", (error) =>
    diagnostics.push(`pageerror: ${error.message}`),
  );
  page.on("console", (message) => {
    if (message.type() === "error")
      diagnostics.push(`console: ${message.text()}`);
  });

  await page.goto(`chrome-extension://${extensionId}/side-panel.html`);
  await page.waitForSelector(".shell");

  return {
    context,
    page,
    worker,
    diagnostics,
    /** UI ではなく実際の保存内容を直接見る。 */
    readStoredRoot: () =>
      worker.evaluate(
        async () =>
          (await chrome.storage.local.get("localDataRoot")).localDataRoot as
            | StoredRoot
            | undefined,
      ),
    close: () => context.close(),
  };
};
