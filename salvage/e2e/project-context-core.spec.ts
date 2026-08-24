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
  projectLifecycleHost,
  projectLifecycleStatus,
} from "./models/project-context.js";
import { buildHarnessPage } from "./support/harness-page.js";

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
  setLifecycleLocale(locale: "ja" | "en"): void;
  failNextLifecycleMutation(): void;
  failNextLifecycleRefresh(): void;
  lifecycleMutationCount(): number;
  resetLifecycle(): Promise<void>;
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

const lifecycleText = {
  ja: {
    list: "架空プロジェクト一覧",
    create: "架空プロジェクトを作成",
    createAction: "作成",
    rename: (name: string) => `${name} の名前を変更`,
    save: "名前を保存",
    delete: (name: string) =>
      `${name} を削除します。所属する架空候補も削除されます。`,
    confirmDelete: "削除する",
    failure: "架空プロジェクトの操作に失敗しました。",
    retry: "一覧だけ再読み込み",
  },
  en: {
    list: "Synthetic project list",
    create: "Create synthetic project",
    createAction: "Create",
    rename: (name: string) => `Rename ${name}`,
    save: "Save name",
    delete: (name: string) =>
      `Delete ${name}. Its synthetic candidates will also be deleted.`,
    confirmDelete: "Delete",
    failure: "The synthetic project operation failed.",
    retry: "Refresh list only",
  },
} as const;

for (const locale of ["ja", "en"] as const) {
  test(`8.4 lifecycle browser harnessは${locale}でCRUD・警告取消・failure・refresh-only recoveryをkeyboard操作できる`, async ({
    page,
  }) => {
    await page.goto(
      await buildHarnessPage(
        "e2e/support/project-context-harness.tsx",
        `project-lifecycle-${locale}`,
      ),
    );
    await page.waitForFunction(() => "projectContextHarness" in window);
    await page.evaluate((nextLocale) => {
      (
        window as unknown as HarnessWindow
      ).projectContextHarness.setLifecycleLocale(nextLocale);
    }, locale);
    await page.evaluate(async () => {
      await (
        window as unknown as HarnessWindow
      ).projectContextHarness.resetLifecycle();
    });
    const text = lifecycleText[locale];
    const host = projectLifecycleHost(page);
    await expect(
      host.getByRole("navigation", { name: text.list }),
    ).toBeVisible();

    const createInput = host.getByRole("textbox", { name: text.create });
    await createInput.fill("Synthetic Charlie");
    await createInput.press("Enter");
    await expect(
      host.getByText("Synthetic Charlie", { exact: true }),
    ).toBeVisible();

    await host
      .getByRole("button", { name: text.rename("架空アルファ") })
      .press("Enter");
    const renameInput = host.getByRole("textbox", {
      name: text.rename("架空アルファ"),
    });
    await renameInput.fill("Synthetic Alpha renamed");
    await renameInput.press("Enter");
    await expect(
      host.getByText("Synthetic Alpha renamed", { exact: true }),
    ).toBeVisible();

    const warning = text.delete("Synthetic Alpha renamed");
    await host.getByRole("button", { name: warning }).press("Enter");
    await expect(host.getByRole("dialog", { name: warning })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(host.getByRole("dialog")).toHaveCount(0);
    await host.getByRole("button", { name: warning }).press("Enter");
    await host
      .getByRole("dialog", { name: warning })
      .getByRole("button", { name: text.confirmDelete })
      .press("Enter");
    await expect(projectContextSelect(page)).toHaveValue(
      "22222222-2222-4222-8222-222222222222",
    );

    for (const name of ["架空ブラボー", "Synthetic Charlie"] as const) {
      const deleteRemaining = text.delete(name);
      await host.getByRole("button", { name: deleteRemaining }).press("Enter");
      await host
        .getByRole("dialog", { name: deleteRemaining })
        .getByRole("button", { name: text.confirmDelete })
        .press("Enter");
    }
    await expect(projectContextSelect(page)).toBeDisabled();
    expect(
      await page.evaluate(
        () =>
          (window as unknown as HarnessWindow).projectContextHarness.snapshot()
            .status,
      ),
    ).toBe("empty");

    await page.evaluate(() => {
      (
        window as unknown as HarnessWindow
      ).projectContextHarness.failNextLifecycleMutation();
    });
    await createInput.fill("Synthetic mutation failure");
    await createInput.press("Enter");
    await expect(projectLifecycleStatus(page)).toHaveText(text.failure);
    await expect(createInput).toHaveValue("Synthetic mutation failure");

    const beforeRecovery = await page.evaluate(() =>
      (
        window as unknown as HarnessWindow
      ).projectContextHarness.lifecycleMutationCount(),
    );
    await page.evaluate(() => {
      (
        window as unknown as HarnessWindow
      ).projectContextHarness.failNextLifecycleRefresh();
    });
    await createInput.fill("Synthetic committed recovery");
    await createInput.press("Enter");
    await host.getByRole("button", { name: text.retry }).press("Enter");
    expect(
      await page.evaluate(() =>
        (
          window as unknown as HarnessWindow
        ).projectContextHarness.lifecycleMutationCount(),
      ),
    ).toBe(beforeRecovery + 1);
    await expect(
      host.getByText("Synthetic committed recovery", { exact: true }),
    ).toBeVisible();
  });
}
