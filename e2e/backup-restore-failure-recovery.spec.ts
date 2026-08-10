import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { action, region } from "./models/locator-primitives.js";
import { restoreFileControl } from "./models/settings.js";
import { expectedText } from "./support/expected-text.js";
import { buildHarnessPage } from "./support/harness-page.js";

/**
 * Cleanup, conflict and finalization failures cannot be provoked from a healthy
 * Chrome profile, so this spec drives the production section mount in a real
 * browser against a real Foundation whose storage boundary can be made to fail.
 * Every assertion goes through the public DOM surface plus the root-write
 * counter, which is what "the existing data was preserved" actually means.
 */

interface Counters {
  readonly rootWrites: number;
  readonly controlWrites: number;
  readonly commitCalls: number;
  readonly finalizeCalls: number;
  readonly refreshCalls: number;
  readonly guard: {
    readonly prepare: number;
    readonly confirm: number;
    readonly cancel: number;
    readonly begin: number;
    readonly complete: number;
  };
  readonly guardOutcomes: readonly string[];
}

interface Harness {
  remount(): Promise<void>;
  failControlWrites(indices: readonly number[]): void;
  setQuota(bytes: number | null): void;
  setGuardMode(mode: "permit" | "confirmation" | "reject"): void;
  setRefreshResult(result: "ready" | "empty" | "unavailable"): void;
  counters(): Counters;
  storedProjectNames(): readonly string[];
  seedStoredRoot(kind: "healthy" | "corrupt" | "unsupported"): void;
  renameExistingProject(name: string): Promise<unknown>;
}

type HarnessWindow = Window & { readonly backupRestoreHarness: Harness };

const RESTORED_PROJECT_NAME = "架空復元プロジェクト";
const SEEDED_PROJECT_NAME = "架空既存プロジェクト";

/** A minimal but valid current-format envelope built from fictional data. */
const RESTORE_ENVELOPE = {
  product: "pc-build-planner",
  formatVersion: 1,
  createdAt: "2026-07-19T00:00:00.000Z",
  data: {
    projects: [
      {
        id: "60000000-0000-4000-8000-000000000001",
        name: RESTORED_PROJECT_NAME,
        createdAt: "2026-07-19T00:00:00.000Z",
        updatedAt: "2026-07-19T00:00:00.000Z",
      },
    ],
    parts: [],
    currentBuilds: [],
  },
} as const;

let harnessUrl = "";

test.beforeAll(async () => {
  harnessUrl = await buildHarnessPage(
    "e2e/support/backup-restore-harness.ts",
    "backup-restore-e2e",
  );
});

const openHarness = async (page: Page): Promise<void> => {
  await page.goto(harnessUrl);
  await page.waitForFunction(() => "backupRestoreHarness" in window);
  await expect(restoreFileControl(page)).toBeVisible();
};

const failControlWrites = (
  page: Page,
  indices: readonly number[],
): Promise<void> =>
  page.evaluate(
    (values) =>
      (
        window as unknown as HarnessWindow
      ).backupRestoreHarness.failControlWrites(values),
    indices,
  );

const setQuota = (page: Page, bytes: number | null): Promise<void> =>
  page.evaluate(
    (value) =>
      (window as unknown as HarnessWindow).backupRestoreHarness.setQuota(value),
    bytes,
  );

const setGuardMode = (
  page: Page,
  mode: "permit" | "confirmation" | "reject",
): Promise<void> =>
  page.evaluate(
    (value) =>
      (window as unknown as HarnessWindow).backupRestoreHarness.setGuardMode(
        value,
      ),
    mode,
  );

const setRefreshResult = (
  page: Page,
  result: "ready" | "empty" | "unavailable",
): Promise<void> =>
  page.evaluate(
    (value) =>
      (
        window as unknown as HarnessWindow
      ).backupRestoreHarness.setRefreshResult(value),
    result,
  );

const seedStoredRoot = (
  page: Page,
  kind: "healthy" | "corrupt" | "unsupported",
): Promise<void> =>
  page.evaluate(
    (value) =>
      (window as unknown as HarnessWindow).backupRestoreHarness.seedStoredRoot(
        value,
      ),
    kind,
  );

const remount = (page: Page): Promise<void> =>
  page.evaluate(async () => {
    await (window as unknown as HarnessWindow).backupRestoreHarness.remount();
  });

const renameExistingProject = (page: Page, name: string): Promise<void> =>
  page.evaluate(async (value) => {
    await (
      window as unknown as HarnessWindow
    ).backupRestoreHarness.renameExistingProject(value);
  }, name);

const counters = (page: Page): Promise<Counters> =>
  page.evaluate(() =>
    (window as unknown as HarnessWindow).backupRestoreHarness.counters(),
  );

const storedProjects = (page: Page): Promise<readonly string[]> =>
  page.evaluate(() =>
    (
      window as unknown as HarnessWindow
    ).backupRestoreHarness.storedProjectNames(),
  );

const selectBackupFile = async (page: Page): Promise<void> => {
  await restoreFileControl(page).setInputFiles({
    name: "harness-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(RESTORE_ENVELOPE), "utf8"),
  });
};

const confirmation = (page: Page): Locator =>
  region(page, "restore-confirmation");
const restoreAlert = (page: Page): Locator => page.getByRole("alert");
const restoreGuidance = (page: Page): Locator =>
  region(page, "restore-retry-guidance");

/** Selects the file and confirms the replacement through the public surface. */
const restoreOnce = async (page: Page): Promise<void> => {
  await selectBackupFile(page);
  await expect(confirmation(page)).toBeVisible();
  await action(confirmation(page), "confirm").click();
};

test("取消・guard拒否・容量超過では既存rootと選択が保持され、容量超過は別file選択だけを許す", async ({
  page,
}) => {
  await openHarness(page);

  // Cancelling the replacement confirmation must not touch the stored root.
  await selectBackupFile(page);
  await expect(confirmation(page)).toBeVisible();
  await action(confirmation(page), "cancel").click();
  await expect(confirmation(page)).toHaveCount(0);
  expect((await counters(page)).rootWrites).toBe(0);
  expect(await storedProjects(page)).toEqual([SEEDED_PROJECT_NAME]);

  // An unsaved draft only asks for confirmation; cancelling keeps the ticket.
  await setGuardMode(page, "confirmation");
  await restoreOnce(page);
  const draft = region(page, "restore-draft-confirmation");
  await expect(draft).toBeVisible();
  await action(draft, "cancel-draft").click();
  await expect(draft).toHaveCount(0);
  expect((await counters(page)).rootWrites).toBe(0);

  // A rejecting guard must stop before any Foundation commit is attempted.
  await setGuardMode(page, "reject");
  await restoreOnce(page);
  await expect(restoreAlert(page)).toHaveText(
    expectedText("backup.errors.guard-failed"),
  );
  await expect(restoreGuidance(page)).toHaveText(
    expectedText("backup.retryGuidance.resolve-draft"),
  );
  const afterGuard = await counters(page);
  expect(afterGuard.rootWrites).toBe(0);
  expect(afterGuard.commitCalls).toBe(0);
  expect(afterGuard.guard.begin).toBe(0);
  // Nothing was replaced, so the current selection is never re-validated.
  expect(afterGuard.refreshCalls).toBe(0);
  expect(await storedProjects(page)).toEqual([SEEDED_PROJECT_NAME]);

  // Capacity rejection is not retryable: only another file may be selected.
  await setGuardMode(page, "permit");
  await setQuota(page, 16);
  await selectBackupFile(page);
  await expect(restoreAlert(page)).toHaveText(
    expectedText("backup.errors.quota-exceeded"),
  );
  await expect(restoreGuidance(page)).toHaveText(
    expectedText("backup.retryGuidance.unsupported"),
  );
  await expect(action(page, "retry-restore")).toHaveCount(0);
  await expect(confirmation(page)).toHaveCount(0);
  await expect(restoreFileControl(page)).toBeEnabled();
  const afterCapacity = await counters(page);
  expect(afterCapacity.rootWrites).toBe(0);
  expect(afterCapacity.refreshCalls).toBe(0);
  expect(await storedProjects(page)).toEqual([SEEDED_PROJECT_NAME]);

  // Selecting the same file once capacity allows it completes the restore.
  await setQuota(page, null);
  await restoreOnce(page);
  await expect(page.getByRole("status")).toContainText(
    expectedText("backup.restoreCompleted", {
      projectCount: 1,
      partCount: 0,
      currentBuildCount: 0,
    }),
  );
  const settled = await counters(page);
  expect(settled.rootWrites).toBe(1);
  expect(settled.guardOutcomes).toContain("succeeded");
  expect(await storedProjects(page)).toEqual([RESTORED_PROJECT_NAME]);
});

test("write前cleanup失敗は同じticketでcleanupを再開し、root writeは一度だけになる", async ({
  page,
}) => {
  await openHarness(page);
  // Fail the bind-commit control write and the cleanup that follows it, so the
  // control stays owned by this assessment with the root still untouched.
  await failControlWrites(page, [2, 3]);

  await restoreOnce(page);
  await expect(restoreAlert(page)).toHaveText(
    expectedText("backup.errors.maintenance-active"),
  );
  await expect(restoreGuidance(page)).toHaveText(
    expectedText("backup.retryGuidance.retry-restore"),
  );
  const pending = await counters(page);
  expect(pending.rootWrites).toBe(0);
  expect(await storedProjects(page)).toEqual([SEEDED_PROJECT_NAME]);

  // Retrying with the held ticket resumes cleanup first, then commits once.
  await failControlWrites(page, []);
  await action(page, "retry-restore").click();
  await expect(page.getByRole("status")).toContainText(
    expectedText("backup.restoreCompleted", {
      projectCount: 1,
      partCount: 0,
      currentBuildCount: 0,
    }),
  );
  const resumed = await counters(page);
  expect(resumed.rootWrites).toBe(1);
  expect(await storedProjects(page)).toEqual([RESTORED_PROJECT_NAME]);
});

test("cleanup未完了中は別ticketのcommitが拒否され、root writeは発生しない", async ({
  page,
}) => {
  await openHarness(page);
  await failControlWrites(page, [2, 3]);
  await restoreOnce(page);
  await expect(restoreAlert(page)).toBeVisible();
  expect((await counters(page)).rootWrites).toBe(0);

  // Re-selecting the file mints a new assessment; it must not adopt the
  // control the previous assessment still owns.
  await failControlWrites(page, []);
  await restoreOnce(page);
  await expect(restoreAlert(page)).toHaveText(
    expectedText("backup.errors.maintenance-active"),
  );
  const rejected = await counters(page);
  expect(rejected.rootWrites).toBe(0);
  // The second commit really was attempted, and really was refused.
  expect(rejected.commitCalls).toBe(2);
  expect(await storedProjects(page)).toEqual([SEEDED_PROJECT_NAME]);
});

test("preflight後の競合mutationはstale拒否され、再確認してからだけ復元できる", async ({
  page,
}) => {
  await openHarness(page);
  await selectBackupFile(page);
  await expect(confirmation(page)).toBeVisible();

  // An ordinary mutation lands between preflight and commit.
  await renameExistingProject(page, "架空競合後プロジェクト");
  await action(confirmation(page), "confirm").click();
  await expect(restoreAlert(page)).toHaveText(
    expectedText("backup.errors.stale-ticket"),
  );
  await expect(restoreGuidance(page)).toHaveText(
    expectedText("backup.retryGuidance.reassess-restore"),
  );
  // The competing change survives; the stale assessment wrote nothing.
  expect((await counters(page)).rootWrites).toBe(1);
  expect(await storedProjects(page)).toEqual(["架空競合後プロジェクト"]);

  await action(page, "reassess-restore").click();
  await expect(confirmation(page)).toBeVisible();
  await action(confirmation(page), "confirm").click();
  await expect(page.getByRole("status")).toContainText(
    expectedText("backup.restoreCompleted", {
      projectCount: 1,
      partCount: 0,
      currentBuildCount: 0,
    }),
  );
  expect((await counters(page)).rootWrites).toBe(2);
  expect(await storedProjects(page)).toEqual([RESTORED_PROJECT_NAME]);
});

test("write後cleanup失敗はfinalize-only、refresh失敗はrefresh-onlyになりcommitを再実行しない", async ({
  page,
}) => {
  await openHarness(page);
  // Fail only the post-commit release, so the root write already happened.
  await failControlWrites(page, [3]);
  await setRefreshResult(page, "unavailable");

  await restoreOnce(page);
  await expect(region(page, "restore-finalization")).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    expectedText("backup.restoreCompleted", {
      projectCount: 1,
      partCount: 0,
      currentBuildCount: 0,
    }),
  );
  const committed = await counters(page);
  expect(committed.rootWrites).toBe(1);
  expect(committed.commitCalls).toBe(1);
  expect(committed.refreshCalls).toBe(0);
  expect(committed.guardOutcomes).toEqual(["succeeded"]);
  expect(await storedProjects(page)).toEqual([RESTORED_PROJECT_NAME]);

  // A rebuilt foundation and a fresh section state must rediscover the
  // pending finalization instead of starting from an ordinary idle surface.
  await failControlWrites(page, []);
  await remount(page);
  await expect(region(page, "restore-finalization")).toBeVisible();
  expect((await counters(page)).rootWrites).toBe(1);

  // Finalization is cleanup only, and the failing refresh keeps the restore
  // successful while offering a refresh-only retry.
  await action(page, "finalize").click();
  await expect(region(page, "restore-context-refresh")).toBeVisible();
  const finalized = await counters(page);
  expect(finalized.rootWrites).toBe(1);
  expect(finalized.finalizeCalls).toBe(1);
  expect(finalized.commitCalls).toBe(1);
  expect(finalized.refreshCalls).toBe(1);

  await setRefreshResult(page, "empty");
  await action(page, "refresh-context").click();
  await expect(region(page, "restore-context-refresh")).toHaveCount(0);
  const refreshed = await counters(page);
  expect(refreshed.rootWrites).toBe(1);
  expect(refreshed.commitCalls).toBe(1);
  expect(refreshed.finalizeCalls).toBe(1);
  expect(refreshed.refreshCalls).toBe(2);
  await expect(page.getByRole("status")).toContainText(
    expectedText("backup.restoreCompleted", {
      projectCount: 1,
      partCount: 0,
      currentBuildCount: 0,
    }),
  );
});

test("破損rootからの回復でもwrite後cleanup失敗はfinalize-onlyになり、root writeは一度だけになる", async ({
  page,
}) => {
  await openHarness(page);
  await seedStoredRoot(page, "corrupt");
  await remount(page);
  // Only the post-commit release fails, so the recovery write already landed.
  await failControlWrites(page, [3]);

  await selectBackupFile(page);
  await expect(confirmation(page)).toBeVisible();
  await expect(region(page, "restore-recovery")).toHaveText(
    expectedText("backup.recoveryModeCorrupt"),
  );
  await action(confirmation(page), "confirm").click();

  await expect(region(page, "restore-finalization")).toBeVisible();
  const committed = await counters(page);
  expect(committed.rootWrites).toBe(1);
  expect(committed.commitCalls).toBe(1);
  expect(await storedProjects(page)).toEqual([RESTORED_PROJECT_NAME]);

  await failControlWrites(page, []);
  await action(page, "finalize").click();
  await expect(region(page, "restore-finalization")).toHaveCount(0);
  const finalized = await counters(page);
  expect(finalized.rootWrites).toBe(1);
  expect(finalized.finalizeCalls).toBe(1);
  expect(finalized.commitCalls).toBe(1);
});
