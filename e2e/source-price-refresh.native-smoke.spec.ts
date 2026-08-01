import { expect, test } from "./extension-fixture.js";
import { applicationShell } from "./models/application-shell.js";
import {
  sourcePriceRefresh,
  sourcePriceRefreshField,
  sourcePriceRefreshStatus,
} from "./models/source-price-refresh.js";
import {
  createSourcePriceRefreshRoot,
  extensionId,
  readSourcePriceRefreshRoot,
  seedSourcePriceRefreshRoot,
  sourcePriceRefreshUrls,
  syntheticPricePage,
} from "./support/source-price-refresh-fixture.js";

test.skip(
  process.env.SOURCE_PRICE_REFRESH_NATIVE_SMOKE !== "1",
  "headed manual/OS UI gate only",
);

test("headed Chromiumでnative menuのRefresh priceを一回選択する", async ({
  context,
}) => {
  test.setTimeout(330_000);
  await context.route("https://refresh.synthetic.invalid/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: syntheticPricePage(12_345),
    }),
  );
  await seedSourcePriceRefreshRoot(context);
  const id = await extensionId(context);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/side-panel.html`);
  await expect(applicationShell(panel)).toHaveAttribute(
    "data-runtime-state",
    "started",
  );
  const target = await context.newPage();
  await target.goto(sourcePriceRefreshUrls.primary);
  await target.bringToFront();

  const surface = sourcePriceRefresh(panel);
  await test.step("MANUAL: 架空HTTPSページを右クリックしbrowser-native『Refresh price / 価格を更新』を一回選択する", async () =>
    expect(surface).toBeVisible({ timeout: 300_000 }));
  await expect(sourcePriceRefreshStatus(surface)).toHaveAttribute(
    "data-status",
    "succeeded",
  );
  await expect(sourcePriceRefreshField(surface, "price")).toHaveText(
    "12345 SYN",
  );
  await expect
    .poll(async () => (await readSourcePriceRefreshRoot(context)).revision)
    .toBe(createSourcePriceRefreshRoot().revision + 1);
});
