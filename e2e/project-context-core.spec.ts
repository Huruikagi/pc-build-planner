import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test } from "@playwright/test";
import { build } from "esbuild";

import {
  projectContextConfirmation,
  projectContextRetry,
  projectContextSelect,
  projectContextStatus,
} from "./models/project-context.js";

type Harness = {
  readonly ids: readonly string[];
  setCatalog(names: readonly string[]): Promise<void>;
  setCatalogUnavailable(value: boolean, refresh?: boolean): Promise<void>;
  requireConfirmation(value: boolean): Promise<void>;
  reopen(): Promise<void>;
  replace(
    outcome: "succeeded" | "failed" | "cancelled",
    stale?: boolean,
  ): Promise<{ ok: boolean }>;
  forcedNotifications(): number;
  snapshot(): {
    status: string;
    selectedProjectId: string | null;
    generation: number;
  };
};

type HarnessWindow = Window & { readonly projectContextHarness: Harness };

test("project-context core browser harnessは選択・確認・再open・fallback・unavailable retryを通す", async ({
  page,
}) => {
  const output = await mkdtemp(path.join(tmpdir(), "project-context-e2e-"));
  const bundle = path.join(output, "harness.js");
  await build({
    bundle: true,
    entryPoints: ["e2e/support/project-context-harness.tsx"],
    format: "iife",
    outfile: bundle,
    platform: "browser",
    target: "chrome116",
  });
  const html = path.join(output, "index.html");
  await writeFile(
    html,
    '<!doctype html><div id="root"></div><script src="./harness.js"></script>',
    "utf8",
  );
  await page.goto(pathToFileURL(html).href);
  await page.waitForFunction(() => "projectContextHarness" in window);
  const state = () =>
    page.evaluate(() =>
      (window as unknown as HarnessWindow).projectContextHarness.snapshot(),
    );
  const ids = await page.evaluate(
    () => (window as unknown as HarnessWindow).projectContextHarness.ids,
  );
  await expect(projectContextSelect(page)).toHaveValue(ids[0] ?? "");
  await projectContextSelect(page).selectOption(ids[1] ?? "");
  await expect(projectContextSelect(page)).toHaveValue(ids[1] ?? "");

  await page.evaluate(async () => {
    await (window as unknown as HarnessWindow).projectContextHarness.reopen();
  });
  await expect(projectContextSelect(page)).toHaveValue(ids[1] ?? "");

  await page.evaluate(async () => {
    await (
      window as unknown as HarnessWindow
    ).projectContextHarness.requireConfirmation(true);
  });
  await projectContextSelect(page).selectOption(ids[0] ?? "");
  await expect(projectContextConfirmation(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(projectContextConfirmation(page)).toHaveCount(0);
  await expect(projectContextSelect(page)).toHaveValue(ids[1] ?? "");
  await projectContextSelect(page).selectOption(ids[0] ?? "");
  await projectContextConfirmation(page)
    .getByRole("button", { name: "切り替える" })
    .click();
  await expect(projectContextSelect(page)).toHaveValue(ids[0] ?? "");
  const notificationsBeforeReplacement = await page.evaluate(() =>
    (
      window as unknown as HarnessWindow
    ).projectContextHarness.forcedNotifications(),
  );

  const replacement = (
    outcome: "succeeded" | "failed" | "cancelled",
    stale = false,
  ) =>
    page.evaluate(
      ({ outcome, stale }) =>
        (window as unknown as HarnessWindow).projectContextHarness.replace(
          outcome,
          stale,
        ),
      { outcome, stale },
    );
  expect((await replacement("failed")).ok).toBe(true);
  expect((await replacement("cancelled")).ok).toBe(true);
  expect((await replacement("succeeded", true)).ok).toBe(false);
  expect((await replacement("succeeded")).ok).toBe(true);
  expect(
    await page.evaluate(() =>
      (
        window as unknown as HarnessWindow
      ).projectContextHarness.forcedNotifications(),
    ),
  ).toBe(notificationsBeforeReplacement + 1);

  await page.evaluate(async () => {
    await (window as unknown as HarnessWindow).projectContextHarness.setCatalog(
      ["架空アルファ"],
    );
  });
  await expect(projectContextSelect(page)).toHaveValue(ids[0] ?? "");
  await page.evaluate(async () => {
    await (window as unknown as HarnessWindow).projectContextHarness.setCatalog(
      [],
    );
  });
  await expect(projectContextSelect(page)).toBeDisabled();
  await page.evaluate(async () => {
    await (
      window as unknown as HarnessWindow
    ).projectContextHarness.setCatalogUnavailable(true);
  });
  await expect(projectContextRetry(page)).toBeVisible();
  await expect(projectContextStatus(page)).toHaveText(/利用できません/);
  await page.evaluate(async () => {
    await (
      window as unknown as HarnessWindow
    ).projectContextHarness.setCatalogUnavailable(false, false);
  });
  await projectContextRetry(page).click();
  expect((await state()).status).toBe("empty");
});
