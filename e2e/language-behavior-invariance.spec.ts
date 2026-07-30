import { readFile } from "node:fs/promises";
import type { ConsoleMessage, Page } from "@playwright/test";

import { expect, test } from "./extension-fixture.js";
import {
  applicationShell,
  featureRoot,
  navItem,
} from "./models/application-shell.js";
import {
  confirmDeletionButton,
  createCandidateButton,
  deleteCandidateButton,
  editCandidateButton,
} from "./models/candidate-management.js";
import {
  action,
  formField,
  region,
  submitButton,
} from "./models/locator-primitives.js";
import {
  backupRestoreSection,
  languageSelect,
  restoreFileInput,
  selectLanguage,
} from "./models/settings.js";
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

const en = expectedTextFor("en");

test("英語表示のまま復元しても表示言語が変わらず復元完了通知が英語の1文になる", async ({
  context,
}, testInfo) => {
  const id = await extensionId(context);
  const page = await context.newPage();
  const diagnostics = watchDiagnostics(page);
  await page.goto(`chrome-extension://${id}/side-panel.html`);
  await expect(applicationShell(page)).toHaveAttribute(
    "data-runtime-state",
    "started",
  );
  await selectLanguage(page, "en");

  const candidateManagementRoot = featureRoot(page, "candidate-management");
  const backupRestoreRoot = backupRestoreSection(page);

  await navItem(page, "candidate-management").click();
  await formField(page, "project-name").fill("E2E Language Invariance Project");
  await submitButton(region(candidateManagementRoot, "project-form")).click();
  await expect(
    page.getByRole("button", {
      name: "E2E Language Invariance Project",
      exact: true,
    }),
  ).toBeVisible();

  await createCandidateButton(candidateManagementRoot).click();
  await formField(page, "candidate-name").fill("E2E Kept CPU");
  await formField(page, "candidate-category").selectOption("cpu");
  await formField(page, "attribute-socket").fill("SYN-E2E-EN-1");
  await submitButton(region(candidateManagementRoot, "candidate-form")).click();
  await expect(
    region(candidateManagementRoot, "candidate-list")
      .getByRole("listitem")
      .filter({ hasText: "E2E Kept CPU" }),
  ).toBeVisible();

  // Export while English is displayed.
  await navItem(page, "settings").click();
  const backupRegion = region(backupRestoreRoot, "export");
  await expect(backupRegion).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await action(backupRegion, "export").click();
  const download = await downloadPromise;
  const backupPath = testInfo.outputPath("backup.json");
  await download.saveAs(backupPath);
  const envelope: unknown = JSON.parse(await readFile(backupPath, "utf8"));
  expect(envelope).toMatchObject({ product: "pc-build-planner" });

  // Diverge, then restore. The completion notice must be a natural English
  // sentence — not a concatenation of per-count fragments (4.5) — and
  // language must be unchanged by the restore (1.4, 3.3).
  await navItem(page, "candidate-management").click();
  await createCandidateButton(candidateManagementRoot).click();
  await formField(page, "candidate-name").fill("E2E Restored Away Memory");
  await formField(page, "candidate-category").selectOption("memory");
  await formField(page, "attribute-memoryStandard").fill("SYN-E2E-EN-DDR");
  await submitButton(region(candidateManagementRoot, "candidate-form")).click();
  await expect(
    region(candidateManagementRoot, "candidate-list")
      .getByRole("listitem")
      .filter({ hasText: "E2E Restored Away Memory" }),
  ).toBeVisible();

  await navItem(page, "settings").click();
  const restoreRegion = region(backupRestoreRoot, "restore");
  await restoreFileInput(restoreRegion).setInputFiles(backupPath);
  const confirmation = region(backupRestoreRoot, "restore-confirmation");
  await expect(confirmation).toBeVisible();
  await selectLanguage(page, "ja");
  await expect(confirmation).toBeVisible();
  await selectLanguage(page, "en");
  await expect(confirmation).toBeVisible();
  await action(confirmation, "confirm").click();
  await expect(restoreRegion.getByRole("status")).toContainText(
    en("backup.restoreCompleted", {
      projectCount: 1,
      partCount: 1,
      currentBuildCount: 0,
    }),
  );

  await expect(languageSelect(page)).toHaveValue("en");

  await navItem(page, "candidate-management").click();
  await expect(
    region(candidateManagementRoot, "candidate-list")
      .getByRole("listitem")
      .filter({ hasText: "E2E Kept CPU" }),
  ).toBeVisible();
  await expect(
    region(candidateManagementRoot, "candidate-list")
      .getByRole("listitem")
      .filter({ hasText: "E2E Restored Away Memory" }),
  ).toHaveCount(0);

  // Reload: the persisted preference, not just in-memory state, must still
  // resolve to English (3.1).
  await page.reload();
  await expect(applicationShell(page)).toHaveAttribute(
    "data-runtime-state",
    "started",
  );
  await navItem(page, "settings").click();
  await expect(languageSelect(page)).toHaveValue("en");

  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.consoleErrors).toEqual([]);
});

test("英語表示のままの候補作成・編集・削除は日本語表示時と同じ保存結果になる", async ({
  context,
}) => {
  const id = await extensionId(context);
  const page = await context.newPage();
  const diagnostics = watchDiagnostics(page);
  await page.goto(`chrome-extension://${id}/side-panel.html`);
  await expect(applicationShell(page)).toHaveAttribute(
    "data-runtime-state",
    "started",
  );
  await selectLanguage(page, "en");

  await navItem(page, "candidate-management").click();
  const candidateManagementRoot = featureRoot(page, "candidate-management");
  await formField(page, "project-name").fill("E2E CRUD Invariance Project");
  await submitButton(region(candidateManagementRoot, "project-form")).click();
  await expect(
    page.getByRole("button", {
      name: "E2E CRUD Invariance Project",
      exact: true,
    }),
  ).toBeVisible();

  // Create.
  await createCandidateButton(candidateManagementRoot).click();
  await formField(page, "candidate-name").fill("E2E CRUD GPU");
  await formField(page, "candidate-category").selectOption("gpu");
  await submitButton(region(candidateManagementRoot, "candidate-form")).click();
  const gpuListItem = region(candidateManagementRoot, "candidate-list")
    .getByRole("listitem")
    .filter({ hasText: "E2E CRUD GPU" });
  await expect(gpuListItem).toBeVisible();

  // Edit: the stored draft must come back from persistence unaffected by
  // display language.
  await editCandidateButton(gpuListItem).click();
  await formField(page, "candidate-name").fill("E2E CRUD GPU Revised");
  await submitButton(region(candidateManagementRoot, "candidate-form")).click();
  const revisedListItem = region(candidateManagementRoot, "candidate-list")
    .getByRole("listitem")
    .filter({ hasText: "E2E CRUD GPU Revised" });
  await expect(revisedListItem).toBeVisible();

  // Delete.
  await deleteCandidateButton(revisedListItem).click();
  await confirmDeletionButton(page).click();
  await expect(
    region(candidateManagementRoot, "candidate-list")
      .getByRole("listitem")
      .filter({ hasText: "E2E CRUD GPU" }),
  ).toHaveCount(0);

  // Reload: nothing about the deletion should have been display-language
  // dependent, so the deletion survives a real storage round trip.
  await page.reload();
  await expect(applicationShell(page)).toHaveAttribute(
    "data-runtime-state",
    "started",
  );
  await navItem(page, "candidate-management").click();
  await expect(
    region(candidateManagementRoot, "candidate-list")
      .getByRole("listitem")
      .filter({ hasText: "E2E CRUD GPU" }),
  ).toHaveCount(0);

  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.consoleErrors).toEqual([]);
});
