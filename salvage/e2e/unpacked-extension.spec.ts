import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";

import { expect, extensionPath, test } from "./extension-fixture.js";
import { applicationShell } from "./models/application-shell.js";

interface ExtensionInfo {
  id: string;
  manifestErrors: Array<{ message?: string }>;
  name: string;
  runtimeErrors: Array<{ message?: string }>;
  state: string;
  version: string;
}

const MESSAGE_PLACEHOLDER = /^__MSG_(.+)__$/;

/**
 * Chrome resolves `__MSG_key__` manifest values from `_locales/<default_locale>/
 * messages.json` before ever showing them (e.g. in chrome://extensions), so a
 * comparison against the raw manifest.json string never matches. Resolve it
 * the same way Chrome does before comparing (6.1, 6.5).
 */
async function resolveManifestString(
  value: string,
  defaultLocaleDirectory: string,
): Promise<string> {
  const match = value.match(MESSAGE_PLACEHOLDER);
  if (match === null) return value;
  const catalog = JSON.parse(
    await readFile(path.join(defaultLocaleDirectory, "messages.json"), "utf8"),
  ) as Record<string, { message: string }>;
  const key = match[1] ?? "";
  return catalog[key]?.message ?? value;
}

async function findExtension(
  page: Page,
  manifest: { name: string; version: string },
): Promise<ExtensionInfo | null> {
  return page.evaluate(({ name, version }) => {
    const manager = document.querySelector("extensions-manager");
    const itemList = manager?.shadowRoot?.querySelector("extensions-item-list");
    const items =
      itemList?.shadowRoot?.querySelectorAll("extensions-item") ?? [];

    for (const item of items) {
      const data = (item as HTMLElement & { data?: ExtensionInfo }).data;
      if (data?.name === name && data.version === version) return data;
    }
    return null;
  }, manifest);
}

test("dist is recognized as an error-free unpacked MV3 extension on Chrome 116+", async ({
  context,
}) => {
  const browserVersion = context.browser()?.version();
  expect(
    browserVersion,
    "the persistent context must expose its browser version",
  ).toBeTruthy();
  expect(
    Number.parseInt(browserVersion?.split(".")[0] ?? "0", 10),
  ).toBeGreaterThanOrEqual(116);

  const manifest = JSON.parse(
    await readFile(path.join(extensionPath, "manifest.json"), "utf8"),
  ) as { name: string; version: string; default_locale?: string };
  const defaultLocaleDirectory = path.join(
    extensionPath,
    "_locales",
    manifest.default_locale ?? "en",
  );
  const expectedName = await resolveManifestString(
    manifest.name,
    defaultLocaleDirectory,
  );
  const page = await context.newPage();
  await page.goto("chrome://extensions/");

  await expect
    .poll(
      () =>
        findExtension(page, { name: expectedName, version: manifest.version }),
      {
        message: `Chrome did not recognize unpacked extension at ${extensionPath}`,
        timeout: 10_000,
      },
    )
    .not.toBeNull();

  const extensionInfo = await findExtension(page, {
    name: expectedName,
    version: manifest.version,
  });
  expect(extensionInfo?.id).toMatch(/^[a-p]{32}$/);
  expect(extensionInfo?.state).toBe("ENABLED");
  expect(extensionInfo?.manifestErrors).toEqual([]);
  expect(extensionInfo?.runtimeErrors).toEqual([]);

  const sidePanel = await context.newPage();
  await sidePanel.goto(
    `chrome-extension://${extensionInfo?.id}/side-panel.html`,
  );
  await expect(applicationShell(sidePanel)).toHaveAttribute(
    "data-runtime-state",
    "started",
  );
});
