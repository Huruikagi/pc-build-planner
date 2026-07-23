import type { ConsoleMessage, Page } from "@playwright/test";

import { expect, test } from "./extension-fixture.js";

async function extensionId(context: {
  serviceWorkers(): readonly { url(): string }[];
  waitForEvent(event: "serviceworker"): Promise<{ url(): string }>;
}): Promise<string> {
  const existing = context.serviceWorkers()[0];
  const worker = existing ?? (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  expect(id).toMatch(/^[a-p]{32}$/);
  return id;
}

interface Diagnostics {
  readonly consoleErrors: string[];
  readonly pageErrors: string[];
}

function watchDiagnostics(page: Page): Diagnostics {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error: Error) => pageErrors.push(error.message));
  return { consoleErrors, pageErrors };
}

const FICTIONAL_PRODUCT_HTML = `<!doctype html><html><body>
  <script type="application/ld+json">${JSON.stringify({
    "@type": "Product",
    name: "E2E 架空CPU X200",
    brand: { name: "架空メーカー" },
    offers: { price: "39800", priceCurrency: "JPY" },
  })}</script>
</body></html>`;

/**
 * `chrome.scripting.executeScript` requires a genuine `activeTab` grant from
 * a real toolbar-icon click, which Playwright/CDP cannot simulate for a
 * loaded extension (there is no automatable browser-chrome toolbar). Opening
 * the side panel directly and clicking the in-panel start button therefore
 * always lands on the real, recoverable "permission-lost" path here — this
 * still proves `chrome.tabs.query`, the coordinator, `CaptureState`, and the
 * view render correctly against real Chrome APIs end-to-end. The success
 * path (`chrome.scripting.executeScript` actually extracting a real page)
 * needs a manual click on the built extension's real toolbar icon to verify.
 */
test("side panelはactiveTab未許諾でも実chrome.tabs.queryを通じて回復可能な権限失効を表示する", async ({
  context,
}) => {
  const id = await extensionId(context);

  const productPage = await context.newPage();
  const diagnostics = watchDiagnostics(productPage);
  await productPage.goto(
    `data:text/html,${encodeURIComponent(FICTIONAL_PRODUCT_HTML)}`,
  );
  await productPage.bringToFront();

  const sidePanel = await context.newPage();
  await sidePanel.goto(`chrome-extension://${id}/side-panel.html`);
  await expect(sidePanel.locator("#application-shell")).toHaveAttribute(
    "data-runtime-state",
    "started",
  );

  // A project must exist before capture can save anywhere.
  await sidePanel.getByRole("button", { name: "候補管理" }).click();
  await sidePanel
    .locator("input[name='project-name']")
    .fill("E2E 取り込み先プロジェクト");
  await sidePanel.getByRole("button", { name: "プロジェクトを作成" }).click();
  await expect(
    sidePanel.getByRole("button", {
      name: "E2E 取り込み先プロジェクト",
      exact: true,
    }),
  ).toBeVisible();

  await sidePanel.getByRole("button", { name: "商品取り込み" }).click();
  await expect(
    sidePanel
      .getByRole("region", { name: "取り込み確認" })
      .or(sidePanel.locator("[data-capture-start]")),
  ).toBeVisible();

  await sidePanel.locator("[data-capture-start]").click();

  // No real activeTab grant exists in this harness, so the coordinator's
  // real chrome.tabs.query call correctly reports the page as unreadable.
  await expect(sidePanel.locator("body")).toContainText(
    /ページへのアクセス権限が失効しました/,
    { timeout: 10_000 },
  );
  await expect(sidePanel.locator("[data-capture-retry]")).toBeVisible();

  expect(
    diagnostics.pageErrors,
    "product page must raise no runtime errors",
  ).toEqual([]);
});
