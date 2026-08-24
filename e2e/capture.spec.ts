/**
 * 商品取り込みを、実拡張・実ページ・実 content script 注入で検証する。
 *
 * `docs/reverse/features.md` 2 章とデザインキャンバス「4. 取り込み」に対応。
 * 起点は必ず拡張アイコンの操作で、権限はその都度の `activeTab` に限る。
 */
import { expect, test } from "@playwright/test";
import { manufacturerDomainEntryForUrl } from "../src/capture/manufacturer-domain-map.js";
import {
  type LoadedExtension,
  loadExtension,
  triggerExtensionAction,
} from "./extension.js";
import {
  BLANK_PAGE_HTML,
  BLANK_PAGE_URL,
  PRODUCT_PAGE_HTML,
  PRODUCT_PAGE_URL,
} from "./fixtures/product-page.js";

const serve = async (
  extension: LoadedExtension,
  body: string,
): Promise<void> => {
  await extension.context.route("http://pcbp.test/**", (route) =>
    route.fulfill({
      body,
      contentType: "text/html; charset=utf-8",
      status: 200,
    }),
  );
};

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

const ASUS_PRODUCT_PAGE_URL = "http://rog.asus.com/jp/graphics-cards/syn-test";
const ASUS_PRODUCT_PAGE_HTML = `<!doctype html><html lang="ja"><head>
<meta charset="utf-8"><title>SYN graphics card</title>
</head><body><h1>SYN graphics card</h1></body></html>`;

test.describe("商品取り込み", () => {
  let extension: LoadedExtension;

  // biome-ignore lint/correctness/noEmptyPattern: Playwright は第1引数に分割代入パターンを要求する
  test.beforeEach(async ({}, testInfo) => {
    extension = await loadExtension("ja", testInfo.outputPath("profile"));
  });

  test.afterEach(async () => {
    await extension.close();
  });

  test("構造化データから取り込み、確認して保存すると元表記と分離して残る", async () => {
    const { page, context } = extension;
    await serve(extension, PRODUCT_PAGE_HTML);
    await createProject(extension, "SYN 取り込み検証");

    const target = await context.newPage();
    await target.goto(PRODUCT_PAGE_URL);
    await triggerExtensionAction(extension, target, "http://pcbp.test/");

    // --- 取り込み面は一時表示。常設ナビには現れない ---
    await expect(
      page.locator('[data-capture-status="captured"]'),
    ).toBeVisible();
    await expect(page.locator(".nav__item")).toHaveCount(3);

    /** 取得できた項目には出典が添えられる (features.md 2.2)。 */
    const captured = page.locator('[data-capture-status="captured"]');
    await expect(captured).toContainText("SYN GeForce RTX 5080 SUPER 16GB");
    await expect(captured).toContainText("SYNVIDIA");
    await expect(captured).toContainText("SYN-5080S-16G");
    await expect(captured).toContainText("189,800 JPY");
    await expect(captured.locator(".badge--source").first()).toHaveText(
      "構造化データ",
    );
    /** カテゴリは推定であって確定ではない (2.4)。 */
    await expect(captured.locator(".badge--hint")).toHaveText("推定");

    // --- 引き渡し。再取り込みは起きない ---
    await page.click("[data-capture-accept]");
    await expect(page.locator("[data-part-editor]")).toBeVisible();
    await expect(page.locator('[name="part-name"]')).toHaveValue(
      "SYN GeForce RTX 5080 SUPER 16GB",
    );
    await expect(page.locator('[name="part-manufacturer"]')).toHaveValue(
      "SYNVIDIA",
    );
    await expect(page.locator('[name="part-model-number"]')).toHaveValue(
      "SYN-5080S-16G",
    );
    /** 推定カテゴリが初期選択になる。 */
    await expect(page.locator('[name="part-category"]')).toHaveValue("gpu");

    // --- 元表記は読み取り専用で見える (changes.md C-2-2) ---
    await page.click("[data-originals-toggle]");
    await expect(page.locator(".originals")).toContainText("SYNVIDIA");
    await expect(page.locator(".originals input")).toHaveCount(0);

    await page.click("[data-part-editor] button[type=submit]");
    await expect(page.locator("[data-part-id]")).toHaveCount(1);

    // --- 保存された形。確定値と元表記が分離している (features.md 1.2) ---
    const stored = await extension.readStoredRoot();
    const part = stored?.candidateParts[0];
    expect(part?.category).toBe("gpu");
    expect(part?.manufacturer).toEqual({
      confirmed: "SYNVIDIA",
      original: "SYNVIDIA",
    });
    /** プライマリソースが価格の基準になる (1.5)。 */
    expect(part?.sources).toHaveLength(1);
    expect(part?.sources[0]?.primary).toBe(true);
    expect(part?.sources[0]?.kind).toBe("retail");
    expect(part?.sources[0]?.price).toEqual({
      amount: 189800,
      currency: "JPY",
    });
    expect(part?.sources[0]?.url).toBe(PRODUCT_PAGE_URL);

    expect(extension.diagnostics).toEqual([]);
  });

  /**
   * プロジェクトが 1 件も無い状態でも取り込みは成立する。保存を押した時点の
   * 下書きを黙って捨てず、プロジェクトを作った時点で編集面へ渡す
   * (`changes.md` C-8 / `features.md` の「黙って捨てない」)。
   */
  test("プロジェクトが無いまま取り込んでも下書きを保持し、作成後に引き渡す", async () => {
    const { page, context } = extension;
    await serve(extension, PRODUCT_PAGE_HTML);

    const target = await context.newPage();
    await target.goto(PRODUCT_PAGE_URL);
    await triggerExtensionAction(extension, target, "http://pcbp.test/");

    await expect(
      page.locator('[data-capture-status="captured"]'),
    ).toBeVisible();
    await page.click("[data-capture-accept]");

    // --- 着地点は未選択の空状態。保持していることを明示する ---
    await expect(page.locator("[data-create-project]")).toBeVisible();
    await expect(page.locator(".empty-project__handoff")).toContainText(
      "保持しています",
    );

    /** 画面を移っても下書きは失われない (保持は app.tsx が持つ)。 */
    await page.click('[data-screen="build"]');
    await expect(page.locator(".empty-project__handoff")).toBeVisible();
    await page.click('[data-screen="parts"]');

    await createProject(extension, "SYN 後から作るプロジェクト");

    await expect(page.locator("[data-part-editor]")).toBeVisible();
    await expect(page.locator('[name="part-name"]')).toHaveValue(
      "SYN GeForce RTX 5080 SUPER 16GB",
    );
    expect(extension.diagnostics).toEqual([]);
  });

  test("商品情報を取得できないページは理由を示して手入力へ逃がす", async () => {
    const { page, context } = extension;
    await serve(extension, BLANK_PAGE_HTML);
    await createProject(extension, "SYN 取り込み検証");

    const target = await context.newPage();
    await target.goto(BLANK_PAGE_URL);
    await triggerExtensionAction(extension, target, "http://pcbp.test/");

    const failed = page.locator('[data-capture-status="failed"]');
    await expect(failed).toBeVisible();
    await expect(failed.getByRole("alert")).toContainText("自動取得できません");

    /** 面を閉じれば通常の画面へ戻り、手入力で追加できる。 */
    await page.click("[data-capture-dismiss]");
    await expect(page.locator("[data-create-part]")).toBeVisible();

    const stored = await extension.readStoredRoot();
    expect(stored?.candidateParts ?? []).toEqual([]);
    expect(extension.diagnostics).toEqual([]);
  });

  test("拡張が読み取れないページは注入せず対象外として知らせる", async () => {
    const { page, context } = extension;
    await createProject(extension, "SYN 取り込み検証");

    const target = await context.newPage();
    await target.goto("chrome://version");
    await triggerExtensionAction(extension, target, "chrome://version");

    const failed = page.locator('[data-capture-status="failed"]');
    await expect(failed).toBeVisible();
    await expect(failed.getByRole("alert")).toContainText("読み取れない");
    expect(extension.diagnostics).toEqual([]);
  });

  test("メーカー公式ドメインでは構造化データに brand がなくてもメーカー候補を補完する", async () => {
    const { page, context } = extension;
    await context.route("http://rog.asus.com/**", (route) =>
      route.fulfill({
        body: ASUS_PRODUCT_PAGE_HTML,
        contentType: "text/html; charset=utf-8",
        status: 200,
      }),
    );
    await createProject(extension, "ドメイン補完の検証");

    const target = await context.newPage();
    await target.goto(ASUS_PRODUCT_PAGE_URL);
    await triggerExtensionAction(extension, target, "http://rog.asus.com/");

    const captured = page.locator('[data-capture-status="captured"]');
    await expect(captured).toContainText("ASUS");
    await expect(
      captured.getByText("メーカー公式ドメイン", { exact: true }),
    ).toBeVisible();
    await page.click("[data-capture-accept]");
    await expect(page.locator('[name="part-manufacturer"]')).toHaveValue(
      "ASUS",
    );
    await page.click('[data-part-editor] button[type="submit"]');
    const stored = await extension.readStoredRoot();
    expect(stored?.candidateParts[0]?.sources[0]?.kind).toBe("manufacturer");
    expect(extension.diagnostics).toEqual([]);
  });
});

test.describe("メーカー公式ドメインの登録簿", () => {
  test("登録ドメインとそのサブドメインだけをメーカーに解決する", () => {
    expect(
      manufacturerDomainEntryForUrl("https://rog.asus.com/jp/graphics-cards/"),
    ).toMatchObject({
      manufacturer: "ASUS",
      categories: expect.arrayContaining(["gpu", "motherboard"]),
    });
    expect(
      manufacturerDomainEntryForUrl("https://store.asus.com/jp/"),
    ).toMatchObject({ manufacturer: "ASUS" });
    expect(
      manufacturerDomainEntryForUrl("https://not-asus.com/products"),
    ).toBeUndefined();
  });
});
