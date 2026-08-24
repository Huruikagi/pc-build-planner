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
  fillAttribute,
  LOCALES,
  type LoadedExtension,
  loadExtension,
} from "./extension.js";

const addPart = async (
  { page }: LoadedExtension,
  part: {
    readonly name: string;
    readonly manufacturer?: string;
    readonly modelNumber?: string;
    readonly category: string;
    readonly attributes?: Readonly<Record<string, string>>;
    readonly source?: {
      readonly url: string;
      readonly price: string;
      readonly currency: string;
    };
  },
): Promise<void> => {
  await page.click("[data-create-part]");
  await page.waitForSelector("[data-part-editor]");
  await page.fill('[name="part-name"]', part.name);
  if (part.manufacturer !== undefined)
    await page.fill('[name="part-manufacturer"]', part.manufacturer);
  if (part.modelNumber !== undefined)
    await page.fill('[name="part-model-number"]', part.modelNumber);
  await page.selectOption('[name="part-category"]', part.category);
  for (const [key, value] of Object.entries(part.attributes ?? {}))
    await fillAttribute(page, key, value);
  if (part.source !== undefined) {
    await page.click("[data-source-add]");
    await page.fill('[name^="source-url-"]', part.source.url);
    await page.fill('[name^="source-price-"]', part.source.price);
    await page.fill('[name^="source-currency-"]', part.source.currency);
  }
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

for (const { lang, catalog } of LOCALES) {
  const text = EXPECTED[catalog as ExpectedLocale];

  test.describe(`locale ${lang}`, () => {
    let extension: LoadedExtension;

    // biome-ignore lint/correctness/noEmptyPattern: Playwright は第1引数に分割代入パターンを要求する
    test.beforeEach(async ({}, testInfo) => {
      extension = await loadExtension(lang, testInfo.outputPath("profile"));
    });

    test.afterEach(async () => {
      await extension.close();
    });

    /**
     * どのカタログが引かれたかは、描画された文言そのもので示す。
     *
     * `chrome.i18n.getMessage("@@ui_locale")` はアサートしない。Linux では
     * `--lang` に追従せず `en_US` を返す一方で文言は `--lang` のカタログから
     * 出る、というプラットフォーム差があり、製品の関心事でもない。
     */
    test("ブラウザのUI言語に対応する _locales の文言で描画される", async () => {
      await expect(extension.page.locator(".nav__item")).toHaveText(
        text.nav.map((label) => new RegExp(label)),
      );
    });

    /**
     * 取り込みは拡張アイコンの操作しか起点が無く、パネル側には押せる導線を
     * 置けない (`src/service-worker.ts`)。空状態で置き場所を教え、埋まったら
     * 短いヒントへ退く、という出し分けを固定する。
     */
    test("取り込みの説明は空状態で出し、パーツが入ったら短いヒントへ退く", async () => {
      const { page } = extension;
      await createProject(extension, "SYN 空状態プロジェクト");

      await expect(page.locator("[data-capture-howto]")).toBeVisible();
      await expect(page.locator("[data-capture-hint]")).toHaveCount(0);

      await addPart(extension, {
        name: "SYN 何か 1 件",
        category: "cpu",
      });

      await expect(page.locator("[data-capture-howto]")).toHaveCount(0);
      await expect(page.locator("[data-capture-hint]")).toBeVisible();
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
        modelNumber: "SYN-9800X3D",
        category: "cpu",
        attributes: { socket: "AM5" },
        source: {
          url: "https://pcbp.test/cpu/syn-9800x3d",
          price: "52980",
          currency: "JPY",
        },
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
      const cpuRow = page
        .locator("[data-part-id]")
        .filter({ hasText: "SYN CPU 9800X3D" });
      await expect(cpuRow.locator(".part-row__missing")).toHaveCount(0);
      await expect(cpuRow.locator(".part-row__price")).toHaveText("52,980 JPY");
      await cpuRow.locator("[data-edit-part]").click();
      await page.click("[data-source-remove]");
      await page.click("[data-part-editor] button[type=submit]");
      await expect(cpuRow.locator(".part-row__missing")).toHaveCount(0);
      await expect(cpuRow.locator(".part-row__price")).toHaveText("—");

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

    /** 複数選ぶ規格は手入力を強いない。既知に無い値は捨てず「その他」に残る。 */
    test("複数選ぶ規格は選択式で入力でき、既知に無い値は手入力で残る", async () => {
      const { page } = extension;
      await createProject(extension, "SYN 規格選択");
      await addPart(extension, {
        name: "SYN Case",
        category: "case",
        attributes: {
          supportedMotherboardFormFactors: "ATX, Mini-ITX, SYN-Custom",
        },
      });

      await page.locator("[data-edit-part]").first().click();
      const chips = page.locator(
        'input[name="attribute-supportedMotherboardFormFactors"]',
      );
      await expect(chips.and(page.locator(":checked"))).toHaveCount(2);
      await expect(chips.and(page.locator('[value="ATX"]'))).toBeChecked();
      await expect(chips.and(page.locator('[value="Mini-ITX"]'))).toBeChecked();
      await expect(
        chips.and(page.locator('[value="E-ATX"]')),
      ).not.toBeChecked();
      await expect(
        page.locator(
          '[name="attribute-supportedMotherboardFormFactors-extra"]',
        ),
      ).toHaveValue("SYN-Custom");

      // --- 選択を外すと確定値からも消える ---
      await page
        .locator(
          'label.choice:has(input[value="Mini-ITX"][name="attribute-supportedMotherboardFormFactors"]) .choice__box',
        )
        .click();
      await page.click("[data-part-editor] button[type=submit]");
      const stored = await extension.readStoredRoot();
      expect(
        stored?.candidateParts[0]?.attributes.supportedMotherboardFormFactors
          ?.confirmed,
      ).toEqual(["ATX", "SYN-Custom"]);

      expect(extension.diagnostics).toEqual([]);
    });

    test("型番なしを確定すると欠損に数えず、再編集でも保たれる", async () => {
      const { page } = extension;
      await createProject(extension, "SYN 型番なし");
      await addPart(extension, {
        name: "SYN Thermal Paste",
        manufacturer: "SYNCOOL",
        category: "other",
      });

      const row = page.locator("[data-part-id]").first();
      /** 型番が空欄のうちは「まだ調べていない」として欠損に数える。 */
      await expect(row.locator(".part-row__missing")).toHaveCount(1);

      await row.locator("[data-edit-part]").click();
      await page
        .locator('label.choice:has([name="part-model-number-absent"])')
        .click();
      await expect(page.locator('[name="part-model-number"]')).toBeDisabled();
      await page.click("[data-part-editor] button[type=submit]");

      await expect(row.locator(".part-row__missing")).toHaveCount(0);
      const stored = await extension.readStoredRoot();
      expect(stored?.candidateParts[0]?.modelNumber?.confirmed).toBe("");

      // --- 再編集でも「型番なし」の表明として戻る ---
      await row.locator("[data-edit-part]").click();
      await expect(
        page.locator('[name="part-model-number-absent"]'),
      ).toBeChecked();

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
