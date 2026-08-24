import type { Page } from "@playwright/test";

import { expect, test } from "./extension-fixture.js";
import {
  applicationShell,
  featureRoot,
  navItem,
} from "./models/application-shell.js";
import { action, region } from "./models/locator-primitives.js";
import { projectContextOptions } from "./models/project-context.js";
import {
  backupRestoreSection,
  restoreFileInput,
  selectLanguage,
} from "./models/settings.js";
import { expectedText } from "./support/expected-text.js";
import { extensionId } from "./support/extension-page.js";

/**
 * Recovery from a stored root the Foundation refuses to publish. The degraded
 * side panel is produced by seeding real extension storage and reloading, so
 * the whole path — degraded startup, settings-only surface, recovery commit and
 * the return to the ordinary projection — runs through production composition.
 */

const RESTORED_PROJECT_NAME = "架空回復プロジェクト";
const RESTORED_PART_NAME = "架空回復CPU";
const TIME = "2026-07-19T00:00:00.000Z";
const PROJECT_ID = "70000000-0000-4000-8000-000000000001";
const PART_ID = "70000000-0000-4000-8000-000000000002";

const RECOVERY_BACKUP = {
  product: "pc-build-planner",
  formatVersion: 1,
  createdAt: TIME,
  data: {
    projects: [
      {
        id: PROJECT_ID,
        name: RESTORED_PROJECT_NAME,
        createdAt: TIME,
        updatedAt: TIME,
      },
    ],
    parts: [
      {
        id: PART_ID,
        projectId: PROJECT_ID,
        category: "cpu",
        product: { name: { original: null, confirmed: RESTORED_PART_NAME } },
        sources: [],
        normalizedAttributes: { category: "cpu" },
        createdAt: TIME,
        updatedAt: TIME,
      },
    ],
    currentBuilds: [],
  },
} as const;

const backupFile = () => ({
  name: "recovery-backup.json",
  mimeType: "application/json",
  buffer: Buffer.from(JSON.stringify(RECOVERY_BACKUP), "utf8"),
});

/** Roots the Foundation can neither migrate nor validate, with no real data. */
const DEGRADED_ROOTS = [
  {
    label: "破損root",
    stored: { schemaVersion: 1, revision: "broken" },
    recoveryNotice: "backup.recoveryModeCorrupt",
  },
  {
    label: "未対応version root",
    stored: { schemaVersion: 99, opaque: "synthetic" },
    recoveryNotice: "backup.recoveryModeUnsupported",
  },
] as const;

const writeStoredRoot = (page: Page, root: unknown): Promise<void> =>
  page.evaluate(
    async (value) =>
      new Promise<void>((resolve) => {
        chrome.storage.local.set({ localDataRoot: value }, () => resolve());
      }),
    root,
  );

const readStoredRoot = (page: Page): Promise<unknown> =>
  page.evaluate(
    async () =>
      new Promise<unknown>((resolve) => {
        chrome.storage.local.get("localDataRoot", (result) => {
          resolve((result as { localDataRoot?: unknown }).localDataRoot);
        });
      }),
  );

for (const degraded of DEGRADED_ROOTS) {
  test(`${degraded.label}からdegraded settingsで明示確認付き回復を完了し通常projectionへ戻る`, async ({
    context,
  }) => {
    const id = await extensionId(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/side-panel.html`);
    await expect(applicationShell(page)).toHaveAttribute(
      "data-runtime-state",
      "started",
    );

    // This spec's assertions expect Japanese text; the display language is
    // stored separately from the data root, so pinning it here survives the
    // degraded restart (8.1, 8.2).
    await selectLanguage(page, "ja");

    // Seed the anomalous root through real storage, then restart the panel.
    await writeStoredRoot(page, degraded.stored);
    await page.reload();

    // Degraded startup: settings stays reachable, ordinary features do not.
    await expect(region(page, "recovery-required")).toBeVisible();
    const backupRestoreRoot = backupRestoreSection(page);
    await expect(backupRestoreRoot).toBeVisible();
    const restoreRegion = region(backupRestoreRoot, "restore");
    await expect(restoreFileInput(restoreRegion)).toBeEnabled();
    await navItem(page, "candidate-management").click();
    await expect(backupRestoreRoot).toBeVisible();

    // A file that fails validation must not touch the anomalous root.
    await restoreFileInput(restoreRegion).setInputFiles({
      name: "broken.json",
      mimeType: "application/json",
      buffer: Buffer.from("{ not json", "utf8"),
    });
    await expect(restoreRegion.getByRole("alert")).toHaveText(
      expectedText("backup.errors.not-json"),
    );
    expect(await readStoredRoot(page)).toEqual(degraded.stored);

    // Preflight classifies the current anomaly and asks for explicit consent.
    await restoreFileInput(restoreRegion).setInputFiles(backupFile());
    const confirmation = region(backupRestoreRoot, "restore-confirmation");
    await expect(confirmation).toBeVisible();
    await expect(region(backupRestoreRoot, "restore-recovery")).toHaveText(
      expectedText(degraded.recoveryNotice),
    );

    // Cancelling keeps the anomalous root and reports no recovery success.
    await action(confirmation, "cancel").click();
    await expect(confirmation).toHaveCount(0);
    await expect(restoreRegion.getByRole("status")).toHaveCount(0);
    expect(await readStoredRoot(page)).toEqual(degraded.stored);

    // Confirming performs the recovery commit as a single root replacement.
    await restoreFileInput(restoreRegion).setInputFiles(backupFile());
    await expect(confirmation).toBeVisible();
    await action(confirmation, "confirm").click();
    await expect(restoreRegion.getByRole("status")).toContainText(
      expectedText("backup.restoreCompleted", {
        projectCount: 1,
        partCount: 1,
        currentBuildCount: 0,
      }),
    );
    await expect(region(backupRestoreRoot, "restore-finalization")).toHaveCount(
      0,
    );

    // The first healthy snapshot returns the shell to its ordinary projection
    // and candidate management becomes usable against the restored data.
    await expect(region(page, "recovery-required")).toHaveCount(0);
    await navItem(page, "candidate-management").click();
    const management = featureRoot(page, "candidate-management");
    await expect(projectContextOptions(page)).toHaveText([
      RESTORED_PROJECT_NAME,
    ]);
    await expect(
      region(management, "candidate-list")
        .getByRole("listitem")
        .filter({ hasText: RESTORED_PART_NAME }),
    ).toBeVisible();

    // The restored root survives another restart of the panel.
    await page.reload();
    await expect(applicationShell(page)).toHaveAttribute(
      "data-runtime-state",
      "started",
    );
    await expect(region(page, "recovery-required")).toHaveCount(0);
  });
}
