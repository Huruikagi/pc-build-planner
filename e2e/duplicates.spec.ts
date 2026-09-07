/**
 * 重複判定を実拡張で検証する。`docs/reverse/features.md` 3 章に対応。
 *
 * 固定したい性質:
 * 1. 一致候補があっても勝手に統合せず、排他 2 択を出す
 * 2. 統合は既存パーツのソースを増やすだけで、確定値を壊さない
 * 3. 同一 URL の再取り込みは新規作成ではなく既存ソースの更新になる
 */
import { expect, test } from "@playwright/test";

import {
  type LoadedExtension,
  loadExtension,
  triggerExtensionAction,
} from "./extension.js";
import {
  PRODUCT_PAGE_HTML,
  PRODUCT_PAGE_URL,
} from "./fixtures/product-page.js";

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

const fillEditor = async (
  { page }: LoadedExtension,
  part: {
    readonly name: string;
    readonly manufacturer?: string;
    readonly modelNumber?: string;
    readonly category: string;
  },
): Promise<void> => {
  await page.click("[data-create-part]");
  await page.fill('[name="part-name"]', part.name);
  if (part.manufacturer !== undefined)
    await page.fill('[name="part-manufacturer"]', part.manufacturer);
  if (part.modelNumber !== undefined)
    await page.fill('[name="part-model-number"]', part.modelNumber);
  await page.selectOption('[name="part-category"]', part.category);
  await page.click("[data-part-editor] button[type=submit]");
};

test.describe("重複判定", () => {
  let extension: LoadedExtension;

  // biome-ignore lint/correctness/noEmptyPattern: Playwright は第1引数に分割代入パターンを要求する
  test.beforeEach(async ({}, testInfo) => {
    extension = await loadExtension("ja", testInfo.outputPath("profile"));
    await createProject(extension, "SYN 重複検証");
  });

  test.afterEach(async () => {
    await extension.close();
  });

  test("型番が一致すると確信度つきで一致候補を出し、新規保存を選べる", async () => {
    const { page } = extension;
    await fillEditor(extension, {
      name: "SYN GPU A",
      modelNumber: "SYN-5080S-16G",
      category: "gpu",
    });
    await expect(page.locator("[data-part-id]")).toHaveCount(1);

    /** 型番の区切り文字と大文字小文字は畳んで比較する。 */
    await fillEditor(extension, {
      name: "SYN GPU B",
      modelNumber: "syn 5080s 16g",
      category: "gpu",
    });

    const choice = page.locator("[data-duplicate-choice]");
    await expect(choice).toBeVisible();
    await expect(choice.locator(".badge--high")).toHaveText("高");
    await expect(choice.locator(".duplicate-row__evidence")).toContainText(
      "型番が一致",
    );
    /** 勝手に統合していない。 */
    let stored = await extension.readStoredRoot();
    expect(stored?.candidateParts).toHaveLength(1);

    await page.click("[data-duplicate-save-new]");
    await expect(page.locator("[data-part-id]")).toHaveCount(2);
    stored = await extension.readStoredRoot();
    expect(stored?.candidateParts.map((part) => part.name?.confirmed)).toEqual([
      "SYN GPU A",
      "SYN GPU B",
    ]);

    /** 実保存後の再読込でも、既存候補を変えず新規候補が残る。 */
    await page.reload();
    await page.waitForSelector(".shell");
    await expect(page.locator("[data-part-id]")).toHaveCount(2);
    await expect(page.locator(".part-row__name")).toHaveText([
      "SYN GPU A",
      "SYN GPU B",
    ]);
    expect(extension.diagnostics).toEqual([]);
  });

  test("メーカーと商品名の一致は補助の確信度として出す", async () => {
    const { page } = extension;
    await fillEditor(extension, {
      name: "SYN Cooler",
      manufacturer: "SYNCOOL",
      category: "cpu-cooler",
    });
    await fillEditor(extension, {
      name: "SYN Cooler",
      manufacturer: "syncool",
      category: "cpu-cooler",
    });

    const choice = page.locator("[data-duplicate-choice]");
    await expect(choice.locator(".badge--supporting")).toHaveText("補助");
    await expect(choice.locator(".duplicate-row__evidence")).toContainText(
      "メーカーと商品名が一致",
    );

    /** 編集へ戻れる。戻っても入力は保持される。 */
    await page.click(".editor-bar__back");
    await expect(page.locator('[name="part-name"]')).toHaveValue("SYN Cooler");
    expect(extension.diagnostics).toEqual([]);
  });

  test("統合すると既存パーツへソースが増え、確定値は変わらない", async () => {
    const { page, context } = extension;
    await context.route("http://pcbp.test/**", (route) =>
      route.fulfill({
        body: PRODUCT_PAGE_HTML,
        contentType: "text/html; charset=utf-8",
        status: 200,
      }),
    );

    /** 先に手入力で同じ型番のパーツを作っておく。 */
    await fillEditor(extension, {
      name: "SYN 既存パーツ",
      modelNumber: "SYN-5080S-16G",
      category: "gpu",
    });

    const target = await context.newPage();
    await target.goto(PRODUCT_PAGE_URL);
    await triggerExtensionAction(extension, target, "http://pcbp.test/");
    await page.click("[data-capture-accept]");
    await page.click("[data-part-editor] button[type=submit]");

    await expect(page.locator("[data-duplicate-choice]")).toBeVisible();
    await page.click("[data-duplicate-merge]");

    const stored = await extension.readStoredRoot();
    /** 増えていない。統合されている。 */
    expect(stored?.candidateParts).toHaveLength(1);
    const part = stored?.candidateParts[0];
    /** 既存の確定値は変わらず、取り込み元表記だけが最新値になる。 */
    expect(part?.name).toEqual({
      original: "SYN GeForce RTX 5080 SUPER 16GB",
      confirmed: "SYN 既存パーツ",
    });
    /** ソースだけが増える。既存にソースが無かったので最初の 1 件が基準になる。 */
    expect(part?.sources).toHaveLength(1);
    expect(part?.sources[0]?.url).toBe(PRODUCT_PAGE_URL);

    /**
     * もう一つの取得元も、同じ候補への統合を利用者が選ぶ。複数のページを
     * 1 件の候補に集めても、確認済みの値を自動で置き換えない。
     */
    const secondSourceUrl = `${PRODUCT_PAGE_URL}?source=second`;
    const secondTarget = await context.newPage();
    await secondTarget.goto(secondSourceUrl);
    await triggerExtensionAction(extension, secondTarget, "http://pcbp.test/");
    await page.click("[data-capture-accept]");
    await page.click("[data-part-editor] button[type=submit]");
    await expect(page.locator("[data-duplicate-choice]")).toBeVisible();
    await page.click("[data-duplicate-merge]");

    const merged = await extension.readStoredRoot();
    expect(merged?.candidateParts).toHaveLength(1);
    expect(merged?.candidateParts[0]?.name).toEqual({
      original: "SYN GeForce RTX 5080 SUPER 16GB",
      confirmed: "SYN 既存パーツ",
    });
    expect(
      merged?.candidateParts[0]?.sources.map((source) => source.url),
    ).toEqual([PRODUCT_PAGE_URL, secondSourceUrl]);

    /** 保存済みルートだけでなく、再読込後の編集 UI でも分離を確認する。 */
    await page.reload();
    await page.waitForSelector(".shell");
    await expect(page.locator("[data-part-id]")).toHaveCount(1);
    await page.locator("[data-edit-part]").click();
    await expect(page.locator('[name="part-name"]')).toHaveValue(
      "SYN 既存パーツ",
    );
    await page.click("[data-originals-toggle]");
    await expect(page.locator(".originals")).toContainText(
      "SYN GeForce RTX 5080 SUPER 16GB",
    );
    await expect(page.locator('[name^="source-url-"]')).toHaveCount(2);
    expect(extension.diagnostics).toEqual([]);
  });

  test("同一URLの再取り込みは新規作成ではなく既存ソースの更新になる", async () => {
    const { page, context } = extension;
    let productPage = PRODUCT_PAGE_HTML;
    await context.route("http://pcbp.test/**", (route) =>
      route.fulfill({
        body: productPage,
        contentType: "text/html; charset=utf-8",
        status: 200,
      }),
    );

    const target = await context.newPage();
    await target.goto(PRODUCT_PAGE_URL);

    // 1 回目
    await triggerExtensionAction(extension, target, "http://pcbp.test/");
    await page.click("[data-capture-accept]");
    await page.click("[data-part-editor] button[type=submit]");
    await expect(page.locator("[data-part-id]")).toHaveCount(1);
    const first = await extension.readStoredRoot();
    const firstSourceId = first?.candidateParts[0]?.sources[0]?.id;

    // 2 回目。同じ URL なので既存パーツが開き、重複の 2 択は出ない。
    // 価格を変えた実ページを再読込して、取得元が更新されることも確認する。
    productPage = PRODUCT_PAGE_HTML.replace('"189800"', '"199800"');
    await target.reload();
    await triggerExtensionAction(extension, target, "http://pcbp.test/");
    await page.click("[data-capture-accept]");
    await expect(page.locator("[data-part-editor]")).toBeVisible();
    await page.click("[data-part-editor] button[type=submit]");
    await expect(page.locator("[data-duplicate-choice]")).toHaveCount(0);
    await expect(page.locator("[data-part-id]")).toHaveCount(1);

    const stored = await extension.readStoredRoot();
    expect(stored?.candidateParts).toHaveLength(1);
    /** ソースは増えず 1 件のまま。 */
    expect(stored?.candidateParts[0]?.sources).toHaveLength(1);
    expect(stored?.candidateParts[0]?.sources[0]?.id).toBe(firstSourceId);
    expect(stored?.candidateParts[0]?.sources[0]?.primary).toBe(true);
    expect(stored?.candidateParts[0]?.sources[0]?.price).toEqual({
      amount: 199800,
      currency: "JPY",
    });

    /** 再読込後も未確認の元表記と更新された取得元を画面で確認できる。 */
    await page.reload();
    await page.waitForSelector(".shell");
    await expect(page.locator("[data-part-id]")).toHaveCount(1);
    await expect(page.locator(".part-row__price")).toHaveText("199,800 JPY");
    await page.locator("[data-edit-part]").click();
    await page.click("[data-originals-toggle]");
    await expect(page.locator(".originals")).toContainText(
      "SYN GeForce RTX 5080 SUPER 16GB",
    );
    expect(extension.diagnostics).toEqual([]);
  });
});
