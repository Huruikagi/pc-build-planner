import { readFile } from "node:fs/promises";
import type { ConsoleMessage, Page } from "@playwright/test";

import { expect, test } from "./extension-fixture.js";
import {
  action,
  applicationShell,
  createCandidateButton,
  expectedText,
  featureRoot,
  formField,
  navItem,
  region,
  restoreFileInput,
  submitButton,
} from "./locators.js";

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

async function openCandidateManagement(page: Page): Promise<void> {
  await navItem(page, "candidate-management").click();
}

async function openBackupRestore(page: Page): Promise<void> {
  await navItem(page, "backupRestore").click();
}

test("side panelからexportしたバックアップが実storageの全データを復元し再起動後も維持される", async ({
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
  const candidateManagementRoot = featureRoot(page, "candidate-management");
  const backupRestoreRoot = featureRoot(page, "backupRestore");

  // Seed a project and a classified candidate that the backup must carry.
  await openCandidateManagement(page);
  await formField(page, "project-name").fill(
    "E2E バックアップ対象プロジェクト",
  );
  await submitButton(region(candidateManagementRoot, "project-form")).click();
  await expect(
    page.getByRole("button", {
      name: "E2E バックアップ対象プロジェクト",
      exact: true,
    }),
  ).toBeVisible();

  await createCandidateButton(candidateManagementRoot).click();
  await formField(page, "candidate-name").fill("E2E 退避対象CPU");
  await formField(page, "candidate-category").selectOption("cpu");
  await formField(page, "attribute-socket").fill("SYN-E2E-CPU");
  await submitButton(region(candidateManagementRoot, "candidate-form")).click();
  await expect(
    region(candidateManagementRoot, "candidate-list")
      .getByRole("listitem")
      .filter({ hasText: "E2E 退避対象CPU" }),
  ).toBeVisible();

  // Export: the real Blob download path must produce a named JSON artifact.
  await openBackupRestore(page);
  const backupRegion = region(backupRestoreRoot, "export");
  await expect(backupRegion).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await action(backupRegion, "export").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(
    /^pc-build-planner-backup-\d{4}-\d{2}-\d{2}\.json$/,
  );
  const backupPath = testInfo.outputPath("backup.json");
  await download.saveAs(backupPath);
  await expect(backupRegion.getByRole("status")).toContainText(
    expectedText("backup.downloaded", { filename: "" }),
  );

  // The artifact is the versioned exchange envelope, not the persistence root.
  const envelope: unknown = JSON.parse(await readFile(backupPath, "utf8"));
  expect(envelope).toMatchObject({
    product: "pc-build-planner",
    formatVersion: 1,
  });
  expect(envelope).not.toHaveProperty("schemaVersion");

  // Diverge the stored data after the backup so the restore has to undo it.
  await openCandidateManagement(page);
  await createCandidateButton(candidateManagementRoot).click();
  await formField(page, "candidate-name").fill("E2E 復元で消える候補");
  await formField(page, "candidate-category").selectOption("memory");
  await formField(page, "attribute-memoryStandard").fill("SYN-E2E-DDR");
  await submitButton(region(candidateManagementRoot, "candidate-form")).click();
  await expect(
    region(candidateManagementRoot, "candidate-list")
      .getByRole("listitem")
      .filter({ hasText: "E2E 復元で消える候補" }),
  ).toBeVisible();

  // Preflight: selecting the file must preview counts without writing.
  await openBackupRestore(page);
  const restoreRegion = region(backupRestoreRoot, "restore");
  await restoreFileInput(restoreRegion).setInputFiles(backupPath);

  const confirmation = region(backupRestoreRoot, "restore-confirmation");
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText(
    expectedText("backup.restoreWarning"),
  );
  await expect(confirmation.getByRole("definition").nth(1)).toHaveText("1");

  // Cancelling must leave the diverged data untouched.
  await action(confirmation, "cancel").click();
  await expect(confirmation).toBeHidden();
  await openCandidateManagement(page);
  await expect(
    region(candidateManagementRoot, "candidate-list")
      .getByRole("listitem")
      .filter({ hasText: "E2E 復元で消える候補" }),
  ).toBeVisible();

  // Confirming replaces every root in a single Foundation write.
  await openBackupRestore(page);
  await restoreFileInput(restoreRegion).setInputFiles(backupPath);
  await expect(confirmation).toBeVisible();
  await action(confirmation, "confirm").click();
  await expect(restoreRegion.getByRole("status")).toContainText(
    expectedText("backup.restoreCompleted", {
      projectCount: 1,
      partCount: 1,
      currentBuildCount: 0,
    }),
  );

  // Reload: the restored snapshot must survive a real storage round trip and
  // the post-backup candidate must be gone rather than merged.
  await page.reload();
  await expect(applicationShell(page)).toHaveAttribute(
    "data-runtime-state",
    "started",
  );
  await openCandidateManagement(page);
  await expect(
    page.getByRole("button", {
      name: "E2E バックアップ対象プロジェクト",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    region(candidateManagementRoot, "candidate-list")
      .getByRole("listitem")
      .filter({ hasText: "E2E 退避対象CPU" }),
  ).toBeVisible();
  await expect(
    region(candidateManagementRoot, "candidate-list")
      .getByRole("listitem")
      .filter({ hasText: "E2E 復元で消える候補" }),
  ).toHaveCount(0);

  // Normal CRUD and a second backup must still work after the replacement.
  await createCandidateButton(candidateManagementRoot).click();
  await formField(page, "candidate-name").fill("E2E 復元後の新候補");
  await formField(page, "candidate-category").selectOption("cpu");
  await formField(page, "attribute-socket").fill("SYN-E2E-CPU2");
  await submitButton(region(candidateManagementRoot, "candidate-form")).click();
  await expect(
    region(candidateManagementRoot, "candidate-list")
      .getByRole("listitem")
      .filter({ hasText: "E2E 復元後の新候補" }),
  ).toBeVisible();

  await openBackupRestore(page);
  const secondDownload = page.waitForEvent("download");
  await action(backupRegion, "export").click();
  expect((await secondDownload).suggestedFilename()).toMatch(
    /^pc-build-planner-backup-\d{4}-\d{2}-\d{2}\.json$/,
  );

  expect(diagnostics.pageErrors, "boot must not raise runtime errors").toEqual(
    [],
  );
  expect(diagnostics.consoleErrors, "boot must not log console errors").toEqual(
    [],
  );
});
