import { expect, test } from "./extension-fixture.js";
import {
  applicationShell,
  documentRoot,
  featureRoot,
  navItem,
  persistentNavigationItems,
} from "./models/application-shell.js";
import { selectLanguage } from "./models/settings.js";
import { expectedTextFor } from "./support/expected-text.js";

/**
 * Resolves the unpacked extension id from the loaded service worker so the side
 * panel document can be opened directly as a trusted extension page.
 */
async function extensionId(context: {
  serviceWorkers(): readonly { url(): string }[];
  waitForEvent(event: "serviceworker"): Promise<{ url(): string }>;
}): Promise<string> {
  const existing = context.serviceWorkers()[0];
  const worker = existing ?? (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  expect(id).toMatch(/^[a-p]{32}$/);
  return id;
}

const en = expectedTextFor("en");

/**
 * One representative, unconditionally-rendered piece of visible text per
 * feature screen, so this check doesn't depend on any pre-existing project
 * or candidate data.
 */
const FEATURE_CHECKS = [
  {
    featureId: "candidate-management",
    key: "candidate.createProjectAction",
  },
  { featureId: "currentBuild", key: "category.storage" },
  { featureId: "compatibility", key: "compatibility.idle" },
  { featureId: "settings", key: "backup.noticeUninstall" },
] as const;

test("英語へ切り替えると4つの常設機能画面すべてで英語カタログの解決値が表示される", async ({
  context,
}) => {
  const id = await extensionId(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/side-panel.html`);
  await expect(applicationShell(page)).toHaveAttribute(
    "data-runtime-state",
    "started",
  );

  // Switching happens only through the in-panel control — never a browser
  // restart, a locale environment variable, or a launch option (8.1).
  await selectLanguage(page, "en");
  await expect(documentRoot(page)).toHaveAttribute("lang", "en");
  await expect(persistentNavigationItems(page)).toHaveCount(4);

  for (const { featureId, key } of FEATURE_CHECKS) {
    await navItem(page, featureId).click();
    const feature = featureRoot(page, featureId);
    await expect(feature).toBeVisible();
    await expect(feature).toContainText(en(key));
  }
});

test("英語へ切り替えた後にサイドパネルを開き直しても英語のまま表示される", async ({
  context,
}) => {
  const id = await extensionId(context);
  const firstOpen = await context.newPage();
  await firstOpen.goto(`chrome-extension://${id}/side-panel.html`);
  await expect(applicationShell(firstOpen)).toHaveAttribute(
    "data-runtime-state",
    "started",
  );
  await selectLanguage(firstOpen, "en");
  await firstOpen.close();

  // A fresh page navigating to the same side panel URL stands in for
  // re-opening the side panel; it shares the extension's real storage.
  const reopened = await context.newPage();
  await reopened.goto(`chrome-extension://${id}/side-panel.html`);
  await expect(applicationShell(reopened)).toHaveAttribute(
    "data-runtime-state",
    "started",
  );

  await navItem(reopened, "candidate-management").click();
  await expect(featureRoot(reopened, "candidate-management")).toContainText(
    en("candidate.createProjectAction"),
  );
});
