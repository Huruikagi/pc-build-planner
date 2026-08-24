/**
 * 互換性判定を実拡張で検証する。
 *
 * `docs/reverse/features.md` 5 章とデザインキャンバス「3. 互換性確認」に対応。
 *
 * 固定したい性質は 3 つ。
 * 1. 判定に使うのは確認済みの値だけ (5.1)
 * 2. 情報不足は不整合ではなく、不足している側だけを名指しする (5.3)
 * 3. 表示が断片の連結にならない (`changes.md` C-2-1)
 */
import { expect, test } from "@playwright/test";

import {
  fillAttribute,
  type LoadedExtension,
  loadExtension,
} from "./extension.js";

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
  attributes: Readonly<Record<string, string>> = {},
): Promise<void> => {
  await page.click('[data-screen="parts"]');
  await page.click("[data-create-part]");
  await page.fill('[name="part-name"]', name);
  await page.selectOption('[name="part-category"]', category);
  for (const [key, value] of Object.entries(attributes))
    await fillAttribute(page, key, value);
  await page.click("[data-part-editor] button[type=submit]");
  await expect(page.locator("[data-part-editor]")).toHaveCount(0);
};

const adopt = async (
  { page }: LoadedExtension,
  category: string,
): Promise<void> => {
  await page.click('[data-screen="build"]');
  await page.selectOption("[data-adopt-category]", category);
  await page.locator("[data-adopt-part]").first().click();
};

test.describe("互換性確認", () => {
  let extension: LoadedExtension;

  // biome-ignore lint/correctness/noEmptyPattern: Playwright は第1引数に分割代入パターンを要求する
  test.beforeEach(async ({}, testInfo) => {
    extension = await loadExtension("ja", testInfo.outputPath("profile"));
    await createProject(extension, "SYN 互換性検証");
  });

  test.afterEach(async () => {
    await extension.close();
  });

  test("ソケットが一致しなければ互換性なしと判定し、根拠を構造化して示す", async () => {
    const { page } = extension;
    await addPart(extension, "SYN CPU AM5", "cpu", { socket: "AM5" });
    await addPart(extension, "SYN M/B LGA1700", "motherboard", {
      socket: "LGA1700",
    });
    await adopt(extension, "cpu");
    await adopt(extension, "motherboard");
    await page.click('[data-screen="compatibility"]');

    await expect(page.locator("[data-aggregate]")).toHaveText("互換性なし");

    const rule = page.locator('[data-rule="cpuMotherboardSocket"]');
    await expect(rule).toHaveAttribute("data-verdict", "incompatible");

    /**
     * C-2-1: 役割・パーツ名・値・理由がそれぞれ独立した要素に入り、
     * 連結して読めなくならない。
     */
    await expect(rule.locator(".verdict__name")).toHaveText("CPUソケット");
    await expect(rule.locator(".verdict__role").nth(0)).toHaveText("CPU");
    await expect(rule.locator(".verdict__part").nth(0)).toHaveText(
      "SYN CPU AM5",
    );
    await expect(rule.locator(".verdict__value").nth(0)).toHaveText("AM5");
    await expect(rule.locator(".verdict__role").nth(1)).toHaveText(
      "マザーボード",
    );
    await expect(rule.locator(".verdict__value").nth(1)).toHaveText("LGA1700");
    /** 理由は完結した 1 文。 */
    await expect(rule.locator(".verdict__reason")).toHaveText(
      "規格が一致していません。",
    );

    expect(extension.diagnostics).toEqual([]);
  });

  test("値が一致すれば適合と判定する", async () => {
    const { page } = extension;
    await addPart(extension, "SYN M/B DDR5", "motherboard", {
      socket: "AM5",
      memoryStandard: "DDR5",
    });
    await addPart(extension, "SYN DDR5 32GB", "memory", {
      memoryStandard: "ddr5",
    });
    await adopt(extension, "motherboard");
    await adopt(extension, "memory");
    await page.click('[data-screen="compatibility"]');

    const rule = page.locator('[data-rule="motherboardMemoryStandard"]');
    /** 表記ゆれ（大文字小文字）は畳んで比較する。 */
    await expect(rule).toHaveAttribute("data-verdict", "compatible");
    await expect(rule.locator(".verdict__reason")).toHaveText(
      "規格が一致しています。",
    );
    expect(extension.diagnostics).toEqual([]);
  });

  test("対応範囲への包含を判定する", async () => {
    const { page } = extension;
    await addPart(extension, "SYN CPU AM5", "cpu", { socket: "AM5" });
    await addPart(extension, "SYN Cooler", "cpu-cooler", {
      supportedSockets: "AM5, AM4, LGA1700",
    });
    await adopt(extension, "cpu");
    await adopt(extension, "cpu-cooler");
    await page.click('[data-screen="compatibility"]');

    const rule = page.locator('[data-rule="coolerCpuSocket"]');
    await expect(rule).toHaveAttribute("data-verdict", "compatible");
    await expect(rule.locator(".verdict__reason")).toHaveText(
      "対応範囲に含まれています。",
    );
    expect(extension.diagnostics).toEqual([]);
  });

  test("確認済みでない値は判定に使わず、情報不足として不足側を名指しする", async () => {
    const { page } = extension;
    /** ソケットを入力しないまま採用する。欠損は正常状態。 */
    await addPart(extension, "SYN CPU 未確認", "cpu");
    await addPart(extension, "SYN M/B AM5", "motherboard", { socket: "AM5" });
    await adopt(extension, "cpu");
    await adopt(extension, "motherboard");
    await page.click('[data-screen="compatibility"]');

    /** 不整合ではない。判定不能。 */
    await expect(page.locator("[data-aggregate]")).toHaveText("判定不能");

    const rule = page.locator('[data-rule="cpuMotherboardSocket"]');
    await expect(rule).toHaveAttribute("data-verdict", "unknown");
    /** 不足しているのは CPU 側だけなので、CPU だけを名指しする。 */
    await expect(rule.locator(".verdict__reason")).toHaveText(
      "CPUの値が未確認のため判定できません。",
    );
    await expect(rule.locator(".verdict__value").nth(0)).toHaveText("未確認");

    /** 次の一手が示され、解消できる画面へ移る。 */
    await rule.locator("[data-resolve-missing]").click();
    await expect(page.locator("[data-create-part]")).toBeVisible();

    expect(extension.diagnostics).toEqual([]);
  });

  test("未採用のカテゴリは選択されていないことを名指しする", async () => {
    const { page } = extension;
    await addPart(extension, "SYN CPU AM5", "cpu", { socket: "AM5" });
    await adopt(extension, "cpu");
    await page.click('[data-screen="compatibility"]');

    const rule = page.locator('[data-rule="cpuMotherboardSocket"]');
    await expect(rule).toHaveAttribute("data-verdict", "unknown");
    await expect(rule.locator(".verdict__reason")).toHaveText(
      "マザーボードが選択されていないため判定できません。",
    );
    expect(extension.diagnostics).toEqual([]);
  });

  test("すべて一致すれば互換性ありと判定する", async () => {
    const { page } = extension;
    await addPart(extension, "SYN CPU AM5", "cpu", { socket: "AM5" });
    await addPart(extension, "SYN M/B", "motherboard", {
      socket: "AM5",
      memoryStandard: "DDR5",
      formFactor: "ATX",
    });
    await addPart(extension, "SYN DDR5", "memory", { memoryStandard: "DDR5" });
    await addPart(extension, "SYN Cooler", "cpu-cooler", {
      supportedSockets: "AM5",
    });
    await addPart(extension, "SYN PSU", "power-supply", { formFactor: "ATX" });
    await addPart(extension, "SYN Case", "case", {
      supportedMotherboardFormFactors: "E-ATX, ATX",
      supportedPowerSupplyFormFactors: "ATX, SFX",
    });
    for (const category of [
      "cpu",
      "motherboard",
      "memory",
      "cpu-cooler",
      "power-supply",
      "case",
    ])
      await adopt(extension, category);

    await page.click('[data-screen="compatibility"]');
    await expect(page.locator("[data-aggregate]")).toHaveText("互換性あり");
    await expect(page.locator('[data-verdict="unknown"]')).toHaveCount(0);
    await expect(page.locator('[data-verdict="incompatible"]')).toHaveCount(0);
    expect(extension.diagnostics).toEqual([]);
  });
});
