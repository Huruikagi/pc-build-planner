/**
 * プロジェクトと候補パーツの一巡を、実拡張を通して検証する。
 *
 * 同じシナリオを ja / en の 2 ロケールで流す。挙動は言語によって変わらない
 * ことが固定すべき性質 (`docs/reverse/features.md` 7.4)。
 * 突き合わせる文言は `expected-text.ts` の最小限だけで、操作はロケール
 * 非依存のセレクタで行う。
 */
import { expect, test } from "@playwright/test";

import { EXPECTED, type ExpectedLocale } from "./expected-text.js";
import {
  LOCALES,
  type LoadedExtension,
  loadExtension,
  resolvedLocale,
} from "./extension.js";

const addPart = async (
  { page }: LoadedExtension,
  part: {
    readonly name: string;
    readonly manufacturer?: string;
    readonly category: string;
    readonly attributes?: Readonly<Record<string, string>>;
  },
): Promise<void> => {
  await page.click("[data-create-part]");
  await page.waitForSelector("[data-part-editor]");
  await page.fill('[name="part-name"]', part.name);
  if (part.manufacturer !== undefined)
    await page.fill('[name="part-manufacturer"]', part.manufacturer);
  await page.selectOption('[name="part-category"]', part.category);
  for (const [key, value] of Object.entries(part.attributes ?? {}))
    await page.fill(`[name="attribute-${key}"]`, value);
  await page.click("[data-part-editor] button[type=submit]");
  await expect(page.locator("[data-part-editor]")).toHaveCount(0);
};

const createProject = async (
  { page }: LoadedExtension,
  name: string,
): Promise<void> => {
  await page.click("[data-project-menu-toggle]");
  await page.fill('[name="project-name"]', name);
  await page.click("[data-project-create] button[type=submit]");
  await expect(
    page.locator(".project-menu__name").filter({ hasText: name }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".project-menu")).toHaveCount(0);
};

for (const { lang, uiLocale, catalog } of LOCALES) {
  const text = EXPECTED[catalog as ExpectedLocale];

  test.describe(`locale ${lang}`, () => {
    let extension: LoadedExtension;

    test.beforeEach(async ({}, testInfo) => {
      extension = await loadExtension(lang, testInfo.outputPath("profile"));
    });

    test.afterEach(async () => {
      await extension.close();
    });

    test("ブラウザのUI言語から _locales を解決する", async () => {
      expect(await resolvedLocale(extension.worker)).toBe(uiLocale);
      /** どのカタログが引かれたかは文言そのもので示す。 */
      await expect(extension.page.locator(".nav__item")).toHaveText(
        text.nav.map((label) => new RegExp(label)),
      );
    });

    test("プロジェクトと候補パーツの一巡が実storageへ反映され再起動後も残る", async () => {
      const { page } = extension;

      // --- プロジェクトはヘッダのポップオーバーだけが持つ (changes.md C-1) ---
      await expect(page.locator("[data-project-menu-toggle]")).toBeVisible();
      await page.click("[data-project-menu-toggle]");
      await expect(page.locator(".project-menu__heading")).toHaveText(
        text.projectMenuHeading,
      );
      await page.keyboard.press("Escape");
      await createProject(extension, "SYN 検証プロジェクト");

      // --- 候補パーツ ---
      await addPart(extension, {
        name: "SYN CPU 9800X3D",
        manufacturer: "SYNAMD",
        category: "cpu",
        attributes: { socket: "AM5" },
      });
      await addPart(extension, {
        name: "SYN M/B B650E-F",
        category: "motherboard",
        attributes: {
          socket: "AM5",
          memoryStandard: "DDR5",
          formFactor: "ATX",
        },
      });
      /** 欠損は正常状態。カテゴリ未分類・属性なしでも保存できる。 */
      await addPart(extension, {
        name: "SYN PSU 850W",
        category: "uncategorized",
      });
      await expect(page.locator("[data-part-id]")).toHaveCount(3);

      // --- カテゴリ絞り込み ---
      await page.click('[data-category="cpu"]');
      await expect(page.locator("[data-part-id]")).toHaveCount(1);
      await page.click('[data-category="all"]');
      await expect(page.locator("[data-part-id]")).toHaveCount(3);

      // --- 編集は一覧を置き換えて開き、確認済みの値が戻る (C-2-3 / 1.2) ---
      await page.locator("[data-edit-part]").first().click();
      await expect(page.locator("[data-part-editor]")).toBeVisible();
      await expect(page.locator("[data-part-id]")).toHaveCount(0);
      await expect(page.locator('[name="attribute-socket"]')).toHaveValue(
        "AM5",
      );
      await expect(page.locator('label[for="attribute-socket"]')).toHaveText(
        text.attributeSocket,
      );
      await page.fill('[name="part-name"]', "SYN CPU 9800X3D 改");
      await page.click("[data-part-editor] button[type=submit]");
      await expect(
        page
          .locator(".part-row__name")
          .filter({ hasText: "SYN CPU 9800X3D 改" }),
      ).toBeVisible();

      // --- 商品名だけは必須。保存せずエラーを出す ---
      await page.click("[data-create-part]");
      await page.click("[data-part-editor] button[type=submit]");
      await expect(page.getByRole("alert")).toHaveText(text.partNameRequired);
      await expect(page.locator("[data-part-editor]")).toBeVisible();
      await page.click(".editor-bar__back");
      await expect(page.locator("[data-part-id]")).toHaveCount(3);

      // --- 削除は確認を挟む ---
      await page.locator("[data-delete-part]").last().click();
      await page.click("[data-confirm-delete]");
      await expect(page.locator("[data-part-id]")).toHaveCount(2);

      // --- UI ではなく実際の保存内容を見る ---
      const stored = await extension.readStoredRoot();
      expect(stored?.projects.map((project) => project.name)).toEqual([
        "SYN 検証プロジェクト",
      ]);
      expect(stored?.candidateParts.map((part) => part.name)).toEqual([
        "SYN CPU 9800X3D 改",
        "SYN M/B B650E-F",
      ]);
      expect(stored?.candidateParts[0]?.attributes.socket?.confirmed).toBe(
        "AM5",
      );

      // --- 再起動しても復元される ---
      await page.reload();
      await page.waitForSelector(".shell");
      await expect(page.locator("[data-part-id]")).toHaveCount(2);
      await expect(page.locator(".project-bar__name")).toHaveText(
        "SYN 検証プロジェクト",
      );

      expect(extension.diagnostics).toEqual([]);
    });

    test("プロジェクトを削除しても選択が有効な値に残る", async () => {
      const { page } = extension;
      await createProject(extension, "SYN 一つ目");
      await createProject(extension, "SYN 二つ目");

      await page.click("[data-project-menu-toggle]");
      await page
        .locator(".project-menu__row")
        .first()
        .locator(".project-menu__icon-button")
        .last()
        .click();
      await page.click(".button--danger");

      const stored = await extension.readStoredRoot();
      expect(stored?.projects).toHaveLength(1);
      expect(
        stored?.projects.some(
          (project) => project.id === stored.selectedProjectId,
        ),
      ).toBe(true);
      expect(extension.diagnostics).toEqual([]);
    });
  });
}
