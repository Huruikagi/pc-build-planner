/**
 * 現在構成を実拡張で検証する。
 *
 * `docs/reverse/features.md` 4 章とデザインキャンバス「2. 現在構成」に対応。
 * 数量は確定ボタンを持たず、フォーカスを外した時点で確定する
 * (`changes.md` C-6)。
 */
import { expect, test } from "@playwright/test";

import { type LoadedExtension, loadExtension } from "./extension.js";

const createProject = async (
  { page }: LoadedExtension,
  name: string,
): Promise<void> => {
  await page.click("[data-project-menu-toggle]");
  await page.fill('[name="project-name"]', name);
  await page.click("[data-project-create] button[type=submit]");
  await page.keyboard.press("Escape");
  await expect(page.locator(".project-menu")).toHaveCount(0);
};

const addPart = async (
  { page }: LoadedExtension,
  name: string,
  category: string,
): Promise<void> => {
  await page.click("[data-create-part]");
  await page.fill('[name="part-name"]', name);
  await page.selectOption('[name="part-category"]', category);
  await page.click("[data-part-editor] button[type=submit]");
  await expect(page.locator("[data-part-editor]")).toHaveCount(0);
};

test.describe("現在構成", () => {
  let extension: LoadedExtension;

  // biome-ignore lint/correctness/noEmptyPattern: Playwright は第1引数に分割代入パターンを要求する
  test.beforeEach(async ({}, testInfo) => {
    extension = await loadExtension("ja", testInfo.outputPath("profile"));
    await createProject(extension, "SYN 構成検証");
    await addPart(extension, "SYN CPU 9800X3D", "cpu");
    await addPart(extension, "SYN DDR5 32GB", "memory");
    await extension.page.click('[data-screen="build"]');
  });

  test.afterEach(async () => {
    await extension.close();
  });

  test("採用・数量変更・解除が実storageへ反映される", async () => {
    const { page } = extension;

    // --- 採用 ---
    await expect(page.locator("[data-adopted-id]")).toHaveCount(0);
    await page.click("[data-adopt-part]");
    await expect(page.locator("[data-adopted-id]")).toHaveCount(1);
    /** 採用済みの候補は再度採用できない。 */
    await expect(page.locator("[data-adopt-part]")).toBeDisabled();

    // --- 同一カテゴリ以外も採用できる ---
    await page.selectOption("[data-adopt-category]", "memory");
    await page.click("[data-adopt-part]");
    await expect(page.locator("[data-adopted-id]")).toHaveCount(2);

    // --- 数量はフォーカスを外した時点で確定する (changes.md C-6) ---
    await expect(page.locator("[data-quantity-for]")).toHaveCount(2);
    const memoryQuantity = page.locator("[data-quantity-for]").nth(1);
    await memoryQuantity.fill("2");
    await memoryQuantity.blur();

    const stored = await extension.readStoredRoot();
    const build = stored?.currentBuilds[0];
    expect(build?.items).toHaveLength(2);
    expect(build?.items.map((item) => item.quantity).sort()).toEqual([1, 2]);

    // --- 解除 ---
    await page.locator("[data-release-part]").first().click();
    await expect(page.locator("[data-adopted-id]")).toHaveCount(1);

    // --- 再起動しても残る ---
    await page.reload();
    await page.waitForSelector(".shell");
    await page.click('[data-screen="build"]');
    await expect(page.locator("[data-adopted-id]")).toHaveCount(1);

    expect(extension.diagnostics).toEqual([]);
  });

  test("正整数でない数量は保存せず直前の値へ戻す", async () => {
    const { page } = extension;
    await page.click("[data-adopt-part]");
    const quantity = page.locator("[data-quantity-for]").first();

    await quantity.fill("0");
    await quantity.blur();
    await expect(page.getByRole("alert")).toContainText("正整数");
    /** 直前の確定値へ戻る。 */
    await expect(quantity).toHaveValue("1");

    await quantity.fill("2.5");
    await quantity.blur();
    await expect(quantity).toHaveValue("1");

    const stored = await extension.readStoredRoot();
    expect(stored?.currentBuilds[0]?.items[0]?.quantity).toBe(1);
    expect(extension.diagnostics).toEqual([]);
  });

  test("候補を削除すると現在構成からも解除される", async () => {
    const { page } = extension;
    await page.click("[data-adopt-part]");
    await expect(page.locator("[data-adopted-id]")).toHaveCount(1);

    await page.click('[data-screen="parts"]');
    await page.locator("[data-delete-part]").first().click();
    await page.click("[data-confirm-delete]");

    await page.click('[data-screen="build"]');
    await expect(page.locator("[data-adopted-id]")).toHaveCount(0);

    const stored = await extension.readStoredRoot();
    expect(stored?.currentBuilds[0]?.items ?? []).toEqual([]);
    expect(extension.diagnostics).toEqual([]);
  });
});
