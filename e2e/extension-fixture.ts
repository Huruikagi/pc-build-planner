import path from "node:path";
import { fileURLToPath } from "node:url";
import { test as base, chromium } from "@playwright/test";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const extensionPath = path.join(repositoryRoot, "dist");

export const test = base.extend({
  context: async ({ browserName }, use, testInfo) => {
    if (browserName !== "chromium") {
      throw new Error("Extension smoke tests require Chrome or Chromium.");
    }

    const channel =
      process.env.PLAYWRIGHT_CHROMIUM_CHANNEL === "chrome"
        ? "chrome"
        : "chromium";
    const context = await chromium.launchPersistentContext(
      testInfo.outputPath("profile"),
      {
        channel,
        headless: process.env.SOURCE_PRICE_REFRESH_NATIVE_SMOKE !== "1",
        args: [
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`,
        ],
      },
    );

    await use(context);
    await context.close();
  },
});

export { expect } from "@playwright/test";
