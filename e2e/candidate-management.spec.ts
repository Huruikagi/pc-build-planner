import type { ConsoleMessage, Page } from "@playwright/test";

import { expect, test } from "./extension-fixture.js";
import { navItem, region } from "./locators.js";

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

interface Diagnostics {
  readonly consoleErrors: string[];
  readonly pageErrors: string[];
}

function watchDiagnostics(page: Page): Diagnostics {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error: Error) => pageErrors.push(error.message));
  return { consoleErrors, pageErrors };
}

test("side panel drives project and candidate management against real storage", async ({
  context,
}) => {
  const id = await extensionId(context);
  const page = await context.newPage();
  const diagnostics = watchDiagnostics(page);
  await page.goto(`chrome-extension://${id}/side-panel.html`);

  await expect(page.locator("#application-shell")).toHaveAttribute(
    "data-runtime-state",
    "started",
  );

  // The feature must be reachable from shell navigation, not just registered.
  const navigation = navItem(page, "candidate-management");
  await expect(navigation).toBeVisible();
  await navigation.click();
  const featureRoot = page.locator(
    '.shell-feature[data-feature-id="candidate-management"]',
  );
  await expect(featureRoot).toBeVisible();

  // Create a project.
  await page.locator("input[name='project-name']").fill("E2E 架空プロジェクト");
  await region(featureRoot, "project-form")
    .locator('button[type="submit"]')
    .click();
  await expect(
    page.getByRole("button", { name: "E2E 架空プロジェクト", exact: true }),
  ).toBeVisible();

  // Create a candidate through the list affordance.
  await featureRoot.locator("[data-create-candidate]").click();
  await page.locator("input[name='candidate-name']").fill("E2E 架空CPU");
  await page.locator("select[name='candidate-category']").selectOption("cpu");
  await page.locator("input[name='attribute-socket']").fill("SYN-E2E-1");
  await region(featureRoot, "candidate-form")
    .locator('button[type="submit"]')
    .click();
  const cpuListItem = region(featureRoot, "candidate-list")
    .getByRole("listitem")
    .filter({ hasText: "E2E 架空CPU" });
  await expect(cpuListItem).toBeVisible();

  // Edit the stored candidate; the draft must come back from persistence.
  await cpuListItem.locator("[data-edit-candidate-id]").click();
  await expect(page.locator("input[name='attribute-socket']")).toHaveValue(
    "SYN-E2E-1",
  );
  await page.locator("input[name='candidate-name']").fill("E2E 架空CPU 改訂版");
  await region(featureRoot, "candidate-form")
    .locator('button[type="submit"]')
    .click();
  await expect(
    region(featureRoot, "candidate-list")
      .getByRole("listitem")
      .filter({ hasText: "E2E 架空CPU 改訂版" }),
  ).toBeVisible();

  // Reload: projects, candidates and confirmed values must be restored.
  await page.reload();
  await expect(page.locator("#application-shell")).toHaveAttribute(
    "data-runtime-state",
    "started",
  );
  await navItem(page, "candidate-management").click();
  await expect(
    page.getByRole("button", { name: "E2E 架空プロジェクト", exact: true }),
  ).toBeVisible();
  await expect(
    region(featureRoot, "candidate-list")
      .getByRole("listitem")
      .filter({ hasText: "E2E 架空CPU 改訂版" }),
  ).toBeVisible();

  expect(diagnostics.pageErrors, "boot must not raise runtime errors").toEqual(
    [],
  );
  expect(diagnostics.consoleErrors, "boot must not log console errors").toEqual(
    [],
  );
});
