import { chromium, expect, test } from "@playwright/test";
import { extensionPath } from "./extension-fixture.js";
import {
  applicationShell,
  featureRoot,
  navItem,
} from "./models/application-shell.js";
import { selectLanguage } from "./models/settings.js";
import { expectedTextFor } from "./support/expected-text.js";

const launch = (profile: string) =>
  chromium.launchPersistentContext(profile, {
    channel:
      process.env.PLAYWRIGHT_CHROMIUM_CHANNEL === "chrome"
        ? "chrome"
        : "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

const extensionId = async (context: Awaited<ReturnType<typeof launch>>) => {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  return new URL(worker.url()).host;
};

test("表示言語は同一profileのブラウザプロセス再起動後も復元される", async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe("chromium");
  const profile = testInfo.outputPath("restart-profile");
  const firstContext = await launch(profile);
  const id = await extensionId(firstContext);
  const firstPage = await firstContext.newPage();
  await firstPage.goto(`chrome-extension://${id}/side-panel.html`);
  await expect(applicationShell(firstPage)).toHaveAttribute(
    "data-runtime-state",
    "started",
  );
  await selectLanguage(firstPage, "en");
  await firstContext.close();

  const restartedContext = await launch(profile);
  try {
    const restartedId = await extensionId(restartedContext);
    const restartedPage = await restartedContext.newPage();
    await restartedPage.goto(
      `chrome-extension://${restartedId}/side-panel.html`,
    );
    await expect(applicationShell(restartedPage)).toHaveAttribute(
      "data-runtime-state",
      "started",
    );
    await navItem(restartedPage, "candidate-management").click();
    await expect(
      featureRoot(restartedPage, "candidate-management"),
    ).toContainText(expectedTextFor("en")("candidate.createProjectAction"));
  } finally {
    await restartedContext.close();
  }
});
